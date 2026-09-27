#!/usr/bin/env bash
# Установка dev-standards в проект: dsh + opencode (по умолчанию), опционально zcode и pre-commit.
# Запуск: ./install.sh <project-dir> [--targets=dsh,opencode,zcode] [--zcode] [--pre-commit]
#   --targets — заменить набор целей (по умолчанию dsh,opencode); --zcode добавляет zcode.
# Идемпотентно: повторный запуск обновляет артефакты, не создавая дублей.
set -euo pipefail

SH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)" # корень репозитория стандартов
HOOK="$SH/hooks/standards-post-tool.mjs"
PLUGIN_REL="./.opencode/plugins/standards-guard.mjs"
# Список скиллов берём из манифеста — новые стандарты подхватываются автоматически
SKILLS="$(node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(m.standards.filter(s=>s.guidance).map(s=>s.id).join(" "))' "$SH/standards.json")"

PROJ=""
PRE_COMMIT=0
PRE_COMMIT_STRICT=0
TARGETS="dsh,opencode"
for arg in "$@"; do
  case "$arg" in
    --pre-commit) PRE_COMMIT=1 ;;
    --pre-commit-strict) PRE_COMMIT=1; PRE_COMMIT_STRICT=1 ;;
    --zcode) TARGETS="${TARGETS},zcode" ;;
    --targets=*) TARGETS="${arg#--targets=}" ;;
    *) PROJ="$arg" ;;
  esac
done
has_target() { case ",$TARGETS," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }
PROJ="${PROJ:-.}"
PROJ="$(cd "$PROJ" && pwd -P)"
EXTRA=""
has_target dsh && EXTRA="${EXTRA:+$EXTRA + }dsh"
has_target opencode && EXTRA="${EXTRA:+$EXTRA + }opencode"
has_target zcode && EXTRA="${EXTRA:+$EXTRA + }zcode"
has_target claude && EXTRA="${EXTRA:+$EXTRA + }claude"
[ "$PRE_COMMIT" = 1 ] && EXTRA="${EXTRA:+$EXTRA + }pre-commit"
if [ "$PRE_COMMIT_STRICT" = 1 ]; then EXTRA="$EXTRA:strict"; fi

# ---------- skills ----------
# dsh: .agents/skills (ранг 200); opencode: .opencode/skills; zcode: ~/.zcode/skills (user-уровень)
if has_target dsh; then
  mkdir -p "$PROJ/.agents/skills"
  for s in $SKILLS; do ln -sfn "$SH/skills/$s" "$PROJ/.agents/skills/$s"; done
fi
if has_target opencode; then
  mkdir -p "$PROJ/.opencode/skills"
  for s in $SKILLS; do ln -sfn "$SH/skills/$s" "$PROJ/.opencode/skills/$s"; done
fi
if has_target claude; then
  mkdir -p "$PROJ/.claude/skills"
  for s in $SKILLS; do ln -sfn "$SH/skills/$s" "$PROJ/.claude/skills/$s"; done
fi

# ---------- AGENTS.md: managed-блок = эталон AGENTS.md этого репозитория ----------
# Содержимое берётся из $SH/AGENTS.md (единственный источник истины) и
# оборачивается маркерами; при повторной установке блок заменяется целиком.
AGENTS="$PROJ/AGENTS.md"
START="<!-- dev-standards:start -->"
END="<!-- dev-standards:end -->"
BLOCK="$START
$(cat "$SH/AGENTS.md")
$END"
BLOCKFILE="$PROJ/.dev-standards-block.tmp"
printf '%s\n' "$BLOCK" > "$BLOCKFILE"
if [ -f "$AGENTS" ] && grep -q 'dev-standards:start' "$AGENTS"; then
  # BSD awk (macOS) не принимает многострочный -v, поэтому блок читается из файла
  awk -v s="$START" -v e="$END" -v bf="$BLOCKFILE" '
    BEGIN { p = 1 }
    $0 == s { while ((getline l < bf) > 0) print l; close(bf); p = 0; next }
    $0 == e { p = 1; next }
    p
  ' "$AGENTS" > "$AGENTS.tmp" && mv "$AGENTS.tmp" "$AGENTS"
else
  printf '\n%s\n' "$BLOCK" >> "$AGENTS"
fi
rm -f "$BLOCKFILE"

# ---------- .gitignore: root-anchored записи (фикс виснущего снапшота opencode на симлинках) ----------
GI="$PROJ/.gitignore"
touch "$GI"
GITIGNORE_PATTERNS="/.standards/"
has_target dsh && GITIGNORE_PATTERNS="$GITIGNORE_PATTERNS /.agents/"
has_target opencode && GITIGNORE_PATTERNS="$GITIGNORE_PATTERNS /.opencode/"
for pat in $GITIGNORE_PATTERNS; do
  grep -qxF "$pat" "$GI" || printf '%s\n' "$pat" >> "$GI"
done

# ---------- dsh: hooks.json (Claude-формат; matcher — строчные имена тулов dsh) ----------
if has_target dsh; then
  mkdir -p "$PROJ/.standards"
  cat > "$PROJ/.standards/hooks.json" <<EOF
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "write|edit",
        "hooks": [
          {
            "type": "command",
            "command": "node '$HOOK'"
          }
        ]
      }
    ]
  }
}
EOF

  # строка моста hooks-claude-code в home-патче (~/.dsh/cordis.patch.yml)
  mkdir -p "$HOME/.dsh"
  if ! grep -q 'dev-standards-hooks' "$HOME/.dsh/cordis.patch.yml" 2>/dev/null; then
    cat >> "$HOME/.dsh/cordis.patch.yml" <<EOF
# dev-standards (managed) — мост Claude-хуков для dsh
- insert:
    - id: dev-standards-hooks
      name: '@deepseek-ai/dsh-hooks-claude-code'
      config:
        configPath: '$PROJ/.standards/hooks.json'
EOF
  fi
fi

# ---------- opencode: симлинк плагина + регистрация в opencode.json(c) ----------
if has_target opencode; then
  mkdir -p "$PROJ/.opencode/plugins"
  ln -sfn "$SH/opencode-plugin/standards-guard.mjs" "$PROJ/.opencode/plugins/standards-guard.mjs"
  if [ -f "$PROJ/opencode.json" ]; then
    OC="$PROJ/opencode.json"
  else
    OC="$PROJ/opencode.jsonc"
  fi
  node "$SH/tools/merge-config.mjs" opencode "$OC" "$PLUGIN_REL"
fi

# ---------- zcode: скиллы в ~/.zcode/skills + hooks в user-конфиг ----------
if has_target zcode; then
  mkdir -p "$HOME/.zcode/skills" "$HOME/.zcode/cli"
  for s in $SKILLS; do
    ln -sfn "$SH/skills/$s" "$HOME/.zcode/skills/$s"
  done
  node "$SH/tools/merge-config.mjs" zcode "$HOME/.zcode/cli/config.json" "node '$HOOK'"
fi

# ---------- pi: extension-пакет в ~/.pi/agent/settings.json (packages) ----------
# У pi нет hooks/MCP — контроль идёт через pi-extension (tool_result), скиллы
# поставляются пакетом ("pi": {"extensions", "skills"} в package.json).
if has_target pi; then
  mkdir -p "$HOME/.pi/agent"
  node "$SH/tools/merge-config.mjs" pi "$HOME/.pi/agent/settings.json" "$SH"
  if command -v pi >/dev/null 2>&1; then
    pi update --extensions >/dev/null 2>&1 || true # подтянуть пакет, если pi доступен
  fi
fi

# ---------- claude: скиллы в .claude/skills + hooks в project .claude/settings.json ----------
# Claude Code читает AGENTS.md нативно (>=2.1.277); для старых версий ставим shim
# CLAUDE.md = "@AGENTS.md", если CLAUDE.md ещё нет. Проектный settings коммитится
# и исполняется (в отличие от ZCode), поэтому хук живёт в проекте.
if has_target claude; then
  node "$SH/tools/merge-config.mjs" claude "$PROJ/.claude/settings.json" "node '$HOOK'"
  if [ ! -f "$PROJ/CLAUDE.md" ]; then
    printf '@AGENTS.md\n' > "$PROJ/CLAUDE.md"
  fi
  # settings.local.json — личные настройки, не коммитим
  grep -qxF '/.claude/settings.local.json' "$GI" 2>/dev/null || printf '%s\n' '/.claude/settings.local.json' >> "$GI"
fi

# ---------- pre-commit (опция): отчёт/strict всех проверок манифеста до коммита ----------
# По умолчанию --report (всегда exit 0, печатает ✗-сводку) — прогрессивный режим
# для существующих проектов; --pre-commit-strict ставит строгий вариант (exit 1 на error).
if [ "$PRE_COMMIT" = 1 ]; then
  mkdir -p "$PROJ/.git/hooks"
  RUN_MODE="report"
  [ "$PRE_COMMIT_STRICT" = 1 ] && RUN_MODE="strict"
  cat > "$PROJ/.git/hooks/pre-commit" <<EOF
#!/usr/bin/env bash
# dev-standards: детерминированные проверки до коммита (режим: $RUN_MODE)
node "$SH/checks/run-all.mjs" "$PROJ" --$RUN_MODE
EOF
  chmod +x "$PROJ/.git/hooks/pre-commit"
fi

echo "dev-standards установлен в $PROJ ($EXTRA)"

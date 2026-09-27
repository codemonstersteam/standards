# dev-standards

Репозиторий стандартов разработки с детерминированными проверками и доставкой
в LLM-харнесы. Концепция — [concept.md](concept.md), отраслевой контекст —
[research.md](research.md). Этот README — про работающий MVP.

## Что это

Ядро стандарта — **пять практик**, каждая с **model-частью** (скилл — «где и как»)
и, где возможно, **script-частью** (детерминированный валидатор). Язык-нейтрально:
Go, TS/JS, Python, Rust (в `modules` — таблица выражения на каждом языке).

| Практика | Guidance | Проверка |
|---|---|---|
| Box-spec: коробка начинается со спецификации + Doc as Code | [skills/box-spec](skills/box-spec/SKILL.md) | `check-api-spec` — контракт и `x-frozen:`; `check-docs` — README с pipe-блоком и таблицей отказов (при существующем контракте) |
| Компонентные тесты — исполняемая спецификация | [skills/component-tests](skills/component-tests/SKILL.md) | `check-component-tests` — `@wip`, `@smoke`, дубли `[error]`, число = `N = 1 + Σ` из дизайна (мягкий пропуск) |
| Модули: 1 вход/1 выход, valid-by-construction, ROP, чистое ядро vs I/O | [skills/modules](skills/modules/SKILL.md) | `check-modules` — одна точка входа на `internal/<slug>/`; `check-constructors` (Go) — фабрика проверяет вход, литералы только в фабрике (только изменённые файлы) |
| TBD | [skills/tbd](skills/tbd/SKILL.md) | `check-tbd` — нет коммитов в trunk, дифф ≤ 600 строк, ветка ≤ 2 дней |
| Release: SemVer по совместимости + тогглы default OFF | [skills/release](skills/release/SKILL.md) | — (guidance; расчёт тега — уровень CI) |

**Прогрессивность — для существующих проектов.** Правила действуют на новый и
изменяемый код; проверки мягко пропускают отсутствующие артефакты; по умолчанию
нарушения — `warn` (не блокируют), `error` — только структурная самосогласованность
(дубли сценариев). pre-commit ставится в режиме `--report` (всегда exit 0, печатает
✗-сводку); `--pre-commit-strict` — строгий вариант для новых проектов и CI.

[AGENTS.md](AGENTS.md) — эталон стандарта: краткая инструкция модели; `install.sh`
доставляет его в проект как managed-блок. `node checks/run-all.mjs <проект>
[--report|--strict]` — все проверки одной командой.

## Быстрое подключение к проекту

```bash
git clone <этот-репозиторий> && cd standards
./install.sh /path/to/project --targets=dsh,opencode,zcode,pi,claude [--pre-commit|--pre-commit-strict]
```

## Что получает каждый харнес

| | dsh (deepseek-harness) | opencode | pi | ZCode (Z.ai ADE) | Claude Code |
|---|---|---|---|---|---|
| Правила в контексте | managed-блок `AGENTS.md` | то же | то же (читает AGENTS.md нативно) | то же | то же (нативно ≥2.1.277 + shim `CLAUDE.md`=`@AGENTS.md`) |
| Скиллы (подробности) | `.agents/skills/` (ранг 200) | `.opencode/skills/` | из пакета (`"pi": {"skills"}`) | `~/.zcode/skills/` | `.claude/skills/` |
| Контроль в моменте | `~/.dsh/cordis.patch.yml` → мост `hooks-claude-code` → `.standards/hooks.json` → `standards-post-tool.mjs` (advisory через `additionalContext`) | плагин `standards-guard.mjs` (`tool.execute.before`, нарушения → throw с `✗`-списком) | extension-пакет `pi-extension/` (`tool_result` — `✗`-список дописывается в результат тула; у pi нет hooks/MCP) | хук в `~/.zcode/cli/config.json` → тот же `standards-post-tool.mjs` (проектные hooks игнорируются — потому user-конфиг) | хук в проектном `.claude/settings.json` (тот же `standards-post-tool.mjs`; коммитится и исполняется) |
| TBD на `git commit` | через тот же hook | плагин | extension (распознаёт команду) | через тот же hook | через тот же hook |

Идемпотентно: повторный запуск обновляет артефакты без дублей. Всё, что
ставится в проект, — симлинки/конфиги на этот клон репозитория; обновление
стандартов = `git pull` здесь (у скиллов dsh hot-reload).

Как выглядит петля: модель правит `api-specification/openapi.yaml` → хук/плагин
запускает релевантные проверки (2–5 с) → при нарушениях модель получает
`✗`-список и исправляет в том же ходу. Advisory-режим: блокировок в MVP нет.

## Проверка репозитория

```bash
node test/run.mjs   # 76 проверок: чекеры (вкл. TBD в реальном git-репо, Go-конструкторы, docs), hook, плагины opencode и pi, run-all (report/strict), install 5 целей (идемпотентность)
```

## Разработка этого репозитория

[AGENTS.md](AGENTS.md) — эталон стандарта (доставляется в проекты как
managed-блок; менять только там). Карта:

- `standards.json` — манифест: `enforcement: script | model | hybrid`, glob-маппинг `paths` → проверки;
- `skills/<id>/SKILL.md` — guidance (frontmatter `name`/`description`), `checks/check-<id>.mjs` — валидатор;
- `hooks/standards-post-tool.mjs` — PostToolUse-hook (Claude-формат: dsh-мост, ZCode);
- `opencode-plugin/standards-guard.mjs` — self-contained плагин opencode;
- `install.sh` + `tools/merge-config.mjs` — установка; `test/` — все проверки.

Правила:

1. Изменение стандарта — согласованно в тройке: манифест + скилл + чекер. Правило без проверки — `model`, с проверкой — `script`/`hybrid`.
2. Чекеры: zero-dep Node ≥18; контракт: `exit 0` + `OK — …` в stdout / `exit 1` + `✗`-строки в stderr; аргумент — projectRoot.
3. Hook и плагин — fail-open; фильтрация по путям из манифеста, не по имени тула.
4. `install.sh` идемпотентен (проверяется тестом); записи в user-конфиги (`~/.zcode`, `~/.dsh`) — только через merge с маркером и бэкапом.
5. Новая функциональность = новый ассерт в `test/run.mjs`; перед коммитом прогон зелёный.
6. Известные грабли: матчеры dsh — строчные `write|edit`; skills opencode — `.opencode/skills` (не `.agents/`); ZCode игнорирует проектные hooks; merge JSONC снимает комментарии; `Array.includes` не ищет подстроку (теги — без `@`).

## Ограничения MVP

- `install.sh` пишет в пользовательские конфиги: `~/.dsh/cordis.patch.yml` (одна строка на проект), при цели `zcode` — `~/.zcode/cli/config.json` (бэкап `.bak-dev-standards`), при цели `pi` — `~/.pi/agent/settings.json` (packages).
- pi: контроль advisory — патч результата тула (`tool_result`); блокирующий режим (`tool_call` со `block: true`) — кандидат фазы 2.
- opencode-плагин: `write` проверяет будущее состояние (контент), `edit` — текущее состояние файла на диске; финальная гарантия — pre-commit/CI.
- Манифест — `standards.json`; spectral/oasdiff добавляются строкой в `standards.json` (полный план — concept.md, фазы 2–3).

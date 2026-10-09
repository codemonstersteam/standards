# dev-standards

Репозиторий стандартов разработки с детерминированными проверками и доставкой
в LLM-харнесы. Концепция — [concept.md](concept.md), отраслевой контекст —
[research.md](research.md). Этот README — про работающий MVP.

**Философия**: стандарт — не набор правил, а исполняемая спецификация,
встроенная в процесс. Модельная часть (скиллы) даёт понимание «где и как»,
скриптовая (чекеры, хуки, pre-commit) — гарантию. Агент — партнёр в соблюдении
стандартов, а не только исполнитель. Термины — в [глоссарии](docs/glossary.md).

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

Возможности по харнесам (✓ — нативная поверхность харнеса, ⚠ — эмуляция/обход
особенности; по образцу матрицы grafana/hatch):

| Возможность | dsh | opencode | pi | ZCode | Claude Code |
|---|:-:|:-:|:-:|:-:|:-:|
| Правила в контексте (managed-блок AGENTS.md) | ✓ | ✓ | ✓ (читает нативно) | ✓ | ✓ (нативно ≥2.1.277 + shim) |
| Скиллы SKILL.md | ✓ `.agents/skills` | ✓ `.opencode/skills` | ✓ из пакета | ⚠ user-level `~/.zcode/skills` | ✓ `.claude/skills` |
| Контроль в моменте | ⚠ мост `hooks-claude-code` | ✓ плагин (`tool.execute.before`) | ⚠ `tool_result`-патч (hooks/MCP нет) | ⚠ user-конфиг (проектные hooks игнорирует) | ✓ проектный хук |
| TBD на `git commit` | ✓ | ✓ | ✓ | ✓ | ✓ |
| pre-commit-отчёт | ✓ | ✓ | ✓ | ✓ | ✓ |

Детали по каждой цели:

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

## Иерархия контроля

```
        ╱╲
       ╱  ╲
      ╱ CI ╲            ← абсолютная гарантия (мин)
     ╱──────╲
    ╱ pre-    ╲         ← высокая гарантия (сек)
   ╱  commit   ╲
  ╱──────────────╲
 ╱  хук (момент)  ╲     ← мгновенная обратная связь, advisory (~0.15 с)
╱──────────────────╲
```

Уровни страхуют друг друга: хук возвращает `✗`-список модели сразу после
правки, pre-commit даёт отчёт человеку, CI блокирует обязательное. Матрица
«практика × уровень» и рецепты —
[docs/combining-approaches.md](docs/combining-approaches.md); устройство хука —
[docs/hooks-guide.md](docs/hooks-guide.md).

## Проверка репозитория

```bash
node tools/generate.mjs --check   # свежесть артефактов (правки — только в rules/)
node tools/generate.mjs --list    # сухой прогон: план артефактов (fresh / would update)
node test/run.mjs                 # 120 проверок: yaml-парсер, генератор (list/clean/миграция маркеров), чекеры (вкл. TBD в реальном git-репо, Go-конструкторы, docs), hook (поведение: fail-open, фильтрация по путям, бюджет времени), плагины opencode и pi, run-all (report/strict), install 5 целей (идемпотентность, миграция блоков v1)
```

## Разработка этого репозитория

[AGENTS.md](AGENTS.md) — эталон стандарта (доставляется в проекты как
managed-блок). **Источник правды — `rules/`**: артефакты генерируются и
коммитятся рядом.

> **Источник подхода к генерации:** [Grafana Hatch](https://github.com/grafana/hatch)
> (Apache-2.0) — модель «источник + сгенерённое коммитятся вместе»,
> freshness-проверка для CI, версионированные маркеры блоков (`v1`), режимы
> list/clean. Реализация своя (zero-dep Node, композиция из YAML-правил и
> мета чекеров — чего Hatch не делает). Формат скиллов — открытый стандарт
> [Agent Skills](https://agentskills.io) (Anthropic): один SKILL.md читают
> все 5 харнессов, per-target генерация не нужна.

Карта:

- `rules/` — источник: `meta.yaml` (версия, порядок, комментарий манифеста) + `<id>/rule.yaml` (правила, STOP, checks-маппинг) + `<id>/prose/*.md` (Суть, Основание, таблица языков);
- `tools/generate.mjs` — генератор из `rules/`: `skills/<id>/SKILL.md` (со штампом provenance `sha256` + `dev-standards@vX`), `standards.json` (манифест для рантаймов), managed-блок списка скиллов в футере AGENTS.md (маркеры версионируются, `v1`), `version` package.json; режимы `--check` (свежесть), `--list` (план), `--clean` (убрать артефакты);
- `lib/yaml.mjs` — мини-парсер restricted YAML (zero-dep, fail-closed с номерами строк);
- `checks/check-<id>.mjs` — валидаторы; своё описание для скиллов отдают через `--meta`;
- `hooks/standards-post-tool.mjs` — PostToolUse-hook (Claude-формат: dsh-мост, ZCode);
- `opencode-plugin/standards-guard.mjs` — self-contained плагин opencode;
- `install.sh` + `tools/merge-config.mjs` — установка; `test/` — все проверки.

Правила:

1. Изменение стандарта — только в `rules/` (машинная часть — в `checks/`): артефакты (`skills/`, `standards.json`, футер AGENTS.md, version) генерируются `node tools/generate.mjs`; ручная правка артефакта роняет `--check`. Правило без проверки — `model`, с проверкой — `script`/`hybrid`.
2. Чекеры: zero-dep Node ≥18; контракт: `exit 0` + `OK — …` в stdout / `exit 1` + `✗`-строки в stderr; аргумент — projectRoot; `--meta` — JSON-описание для генератора.
3. Hook и плагин — fail-open; фильтрация по путям из манифеста, не по имени тула; списки скиллов в подсказках — из манифеста, не хардкодом.
4. `install.sh` идемпотентен (проверяется тестом); записи в user-конфиги (`~/.zcode`, `~/.dsh`) — только через merge с маркером и бэкапом; pre-commit проверяет свежесть артефактов standards-репозитория.
5. Новая функциональность = новый ассерт в `test/run.mjs`; перед коммитом прогон зелёный.
6. Известные грабли: матчеры dsh — строчные `write|edit`; skills opencode — `.opencode/skills` (не `.agents/`); ZCode игнорирует проектные hooks; merge JSONC снимает комментарии; `Array.includes` не ищет подстроку (теги — без `@`); в `package.json` генератор правит только строку `version` — скрипты и прочие поля редактируются руками и сохраняются как есть.

## Обоснование и исследования

Каждая практика отвечает на «почему», а не только «что»: раздел «Основание» в
каждом скилле (генерируется из `rules/<id>/prose/rationale.md`). База:

- [research.md](research.md) — отраслевой контекст: тренды Anthropic, Google,
  китайских вендоров; пробелы рынка, которые закрывает концепт (§8), и
  сходимость паттернов (§7).
- [concept.md](concept.md) — архитектура, петля контроля, уровни принуждения
  и модель угроз.
- Ключевые внешние источники: [Claude Code Hooks](https://docs.anthropic.com/en/docs/claude-code/hooks)
  и [Agent Skills](https://docs.anthropic.com/en/docs/claude-code/skills)
  (Anthropic), [trunkbaseddevelopment.com](https://trunkbaseddevelopment.com),
  [OpenAPI](https://spec.openapis.org), [feature toggles](https://martinfowler.com/articles/feature-toggles.html)
  (Fowler), [semver.org](https://semver.org), [Grafana Hatch](https://github.com/grafana/hatch)
  (модель генерации артефактов).

## Ограничения MVP

- `install.sh` пишет в пользовательские конфиги: `~/.dsh/cordis.patch.yml` (одна строка на проект), при цели `zcode` — `~/.zcode/cli/config.json` (бэкап `.bak-dev-standards`), при цели `pi` — `~/.pi/agent/settings.json` (packages).
- pi: контроль advisory — патч результата тула (`tool_result`); блокирующий режим (`tool_call` со `block: true`) — кандидат фазы 2.
- opencode-плагин: `write` проверяет будущее состояние (контент), `edit` — текущее состояние файла на диске; финальная гарантия — pre-commit/CI.
- Манифест `standards.json` и скиллы `skills/` генерируются из `rules/` (`node tools/generate.mjs --check` — свежесть); spectral/oasdiff добавляются новым чекером + записью в `rule.yaml`.

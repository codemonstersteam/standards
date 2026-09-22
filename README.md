# dev-standards

Репозиторий стандартов разработки с детерминированными проверками и доставкой
в LLM-харнесы. Концепция — [concept.md](concept.md), отраслевой контекст —
[research.md](research.md). Этот README — про работающий MVP.

## Что это

Пять требований стандарта, каждое с **model-частью** (скилл — «где и как»)
и **script-частью** (детерминированный валидатор, exit 0/1):

| Требование | Guidance | Проверка |
|---|---|---|
| API First: спека первична и заморожена | [skills/api-spec](skills/api-spec/SKILL.md) | `check-api-spec` — `api-specification/openapi.yaml` существует, `openapi: 3.x`, в `paths:` есть пути, есть `responses:`, маркер `x-frozen:` |
| Компонентные тесты по формуле | [skills/component-tests](skills/component-tests/SKILL.md) | `check-component-tests` — `component-tests/**/*.feature`: все бизнес-сценарии `@wip`, есть `@smoke`, нет дублей, число сценариев = формуле `N = 1 + Σ` из `docs/design/**/contracts.md` (мягкий пропуск, если не объявлена) |
| Модули: один вход, один выход | [skills/modules](skills/modules/SKILL.md) | `check-modules` — в каждом `internal/<slug>/` ровно одна точка входа (index/handler/request/usecase); `internal/shared/` — исключение |
| TBD (trunk-based development) | [skills/tbd](skills/tbd/SKILL.md) | `check-tbd` — нет коммитов напрямую в trunk/main/master; дифф feature-ветки ≤ 600 строк; ветка живёт ≤ 2 дней (запускается из `run-all`, pre-commit и хуком при `git commit`) |

[AGENTS.md](AGENTS.md) — эталон стандарта: краткая инструкция модели; `install.sh`
доставляет его в проект как managed-блок. Разделение «что скриптами, что модели»
декларировано данными — [standards.json](standards.json): per-standard
`enforcement`, glob-маппинг «изменённый файл → какие проверки запускать»
(TBD — по триггеру `git commit`). `node checks/run-all.mjs <проект>` — все
проверки одной командой.

## Быстрое подключение к проекту

```bash
git clone <этот-репозиторий> && cd dev-standards
./install.sh /path/to/project            # dsh + opencode
./install.sh /path/to/project --zcode --pre-commit   # + ZCode + pre-commit
```

Идемпотентно: повторный запуск обновляет артефакты без дублей. Всё, что
ставится в проект, — симлинки/конфиги на этот клон репозитория; обновление
стандартов = `git pull` здесь (у скиллов dsh hot-reload).

## Что получает каждый харнес

| | dsh (deepseek-harness) | opencode | ZCode |
|---|---|---|---|
| Правила в контексте | managed-блок `AGENTS.md` | то же | то же |
| Скиллы (подробности) | `.agents/skills/` (ранг 200) | `.opencode/skills/` | `~/.zcode/skills/` |
| Контроль в моменте | `~/.dsh/cordis.patch.yml` → мост `hooks-claude-code` → `.standards/hooks.json` → `hooks/standards-post-tool.mjs` (PostToolUse, advisory через `additionalContext`) | плагин `.opencode/plugins/standards-guard.mjs` (`tool.execute.before`, нарушения → throw с `✗`-списком) | хук в `~/.zcode/cli/config.json` → тот же `standards-post-tool.mjs` (проектные hooks ZCode игнорирует — потому user-конфиг; бэкап снимается автоматически) |
| До CI | — | — | `--pre-commit` ставит `.git/hooks/pre-commit` с обеими проверками (общее для всех) |

Как выглядит петля: модель правит `api-specification/openapi.yaml` → хук/плагин
запускает релевантные проверки (2–5 с) → при нарушениях модель получает
`✗`-список и исправляет в том же ходу. Advisory-режим: блокировок в MVP нет.

## Проверка репозитория

```bash
node test/run.mjs   # 55 проверок: чекеры (вкл. TBD в реальном git-репо), hook, плагин, run-all, install (идемпотентность, zcode-merge)
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

- pi не поддержан (нет hooks/MCP — нужен extension, фаза 2 концепта).
- `install.sh` пишет в пользовательские конфиги `~/.dsh/cordis.patch.yml`
  (одна строка на проект) и при `--zcode` — `~/.zcode/cli/config.json`
  (бэкап `.bak-dev-standards`).
- opencode-плагин: `write` проверяет будущее состояние (контент), `edit` —
  текущее состояние файла на диске; финальная гарантия — pre-commit/CI.
- Манифест — `standards.json`; spectral/oasdiff добавляются строкой в
  `standards.json` (полный план — concept.md, фазы 2–3).

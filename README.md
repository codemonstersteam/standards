# dev-standards

Репозиторий стандартов разработки с детерминированными проверками и доставкой
в LLM-харнесы. Концепция — [concept.md](concept.md), отраслевой контекст —
[research.md](research.md). Этот README — про работающий MVP.

## Что это

Два требования стандарта, каждое с **model-частью** (скилл — «где и как»)
и **script-частью** (детерминированный валидатор, exit 0/1):

| Требование | Guidance | Проверка |
|---|---|---|
| API-спека первична и заморожена | [skills/api-spec](skills/api-spec/SKILL.md) | `checks/check-api-spec.mjs` — файл `api-specification/openapi.yaml` существует, `openapi: 3.x`, в `paths:` есть пути, есть `responses:`, маркер `x-frozen:` |
| Компонентные тесты — исполняемая спецификация | [skills/component-tests](skills/component-tests/SKILL.md) | `checks/check-component-tests.mjs` — `component-tests/features/*.feature`: все бизнес-сценарии `@wip`, есть `@smoke`, нет дублей названий, число сценариев = формуле `N = 1 + Σ` из `docs/design/**/contracts.md` (мягкий пропуск, если не объявлена) |

Разделение «что скриптами, что модели» декларировано данными —
[standards.json](standards.json) (JSON — валидный подсет YAML; так скрипты
zero-dep): per-standard `enforcement`, glob-маппинг «изменённый файл → какие
проверки запускать».

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
node test/run.mjs   # 38 проверок: чекеры, hook, плагин, install (идемпотентность, zcode-merge)
```

## Ограничения MVP

- pi не поддержан (нет hooks/MCP — нужен extension, фаза 2 концепта).
- `install.sh` пишет в пользовательские конфиги `~/.dsh/cordis.patch.yml`
  (одна строка на проект) и при `--zcode` — `~/.zcode/cli/config.json`
  (бэкап `.bak-dev-standards`).
- opencode-плагин: `write` проверяет будущее состояние (контент), `edit` —
  текущее состояние файла на диске; финальная гарантия — pre-commit/CI.
- Манифест — `standards.json`; spectral/oasdiff добавляются строкой в
  `standards.json` (полный план — concept.md, фазы 2–3).

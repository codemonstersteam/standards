# AGENTS.md — dev-standards

Репозиторий стандартов разработки: манифест + скиллы (guidance) + детерминированные
проверки + доставка в LLM-харнесы (dsh, opencode, ZCode). Разделение «что проверяется
скриптами, что отдаётся модели» декларировано данными в манифесте. Концепция —
[concept.md](concept.md), отраслевой контекст — [research.md](research.md),
quickstart — [README.md](README.md).

## Карта

- `standards.json` — манифест: стандарты с `enforcement: script | model | hybrid`, guidance-файл и проверки с glob-маппингом `paths` → «изменённый файл → какие проверки запускать».
- `skills/<id>/SKILL.md` — guidance-часть стандарта (frontmatter `name`/`description` обязателен).
- `checks/check-<id>.mjs` — валидатор стандарта.
- `hooks/standards-post-tool.mjs` — PostToolUse-hook в Claude-формате (dsh через мост `hooks-claude-code`, ZCode через `~/.zcode/cli/config.json`): advisory-обратная связь `additionalContext`.
- `opencode-plugin/standards-guard.mjs` — self-contained плагин opencode (`tool.execute.before`, нарушения → throw).
- `install.sh` + `tools/merge-config.mjs` — установка в проект (`--targets=dsh,opencode,zcode`, `--pre-commit`).
- `test/run.mjs` + `test/fixtures/{good,bad}` — все проверки репозитория.

## Правила разработки в этом репозитории

1. **Изменение стандарта — согласованно в тройке**: манифест + скилл + чекер. Правило
   без детерминированной проверки — `model`; с проверкой — `script`/`hybrid`.
2. **Чекеры**: zero-dep Node ≥18; контракт: `exit 0` + строка `OK — …` в stdout /
   `exit 1` + `✗`-строки в stderr; аргумент — projectRoot.
3. **Hook и плагин — fail-open**: инфраструктурная ошибка не мешает агенту;
   нарушения возвращаются модели. Фильтрация — по путям из манифеста, не по имени тула.
4. **`install.sh` идемпотентен**: повторный прогон не создаёт дублей (проверяется
   тестом). Записи в user-конфиги (`~/.zcode`, `~/.dsh`) — только через merge
   с маркером и бэкапом.
5. **Новая функциональность = новый ассерт в `test/run.mjs`**; перед коммитом прогон
   зелёный: `node test/run.mjs`.
6. **Известные грабли** (проверено на практике — не наступать):
   - матчеры dsh — строчные имена тулов: `write|edit`;
   - skills opencode живут в `.opencode/skills` (НЕ `.agents/skills`);
   - ZCode игнорирует проектные hooks — только `~/.zcode/cli/config.json` или плагин;
   - merge JSONC (`merge-config.mjs`) снимает комментарии — он предупреждает в stderr;
   - `Array.includes` не ищет подстроку — теги сравниваются по имени без `@`.

## Проверка и подключение

```bash
node test/run.mjs                              # все проверки репозитория
./install.sh <проект> [--targets=dsh,opencode,zcode] [--pre-commit]
```

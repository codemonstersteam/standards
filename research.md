# research.md — Как индустрия строит AI-конвейер и контроль стандартов, и как с этим сходится наш concept.md

> Дата: 2026-09-21. Материал — веб-исследование по официальным источникам (блоги, доки, стандарты); каждое утверждение снабжено ссылкой. То, что не удалось проверить напрямую, помечено «вторично».
> Нарратив документа: §1 — проблема, которую мы решаем → §2–6 — как её решают вендоры и организации → §7 — общие паттерны → §8 — пробелы рынка → §9 — как с этим сходится [concept.md](concept.md) → §10 — вывод → §11 — полный список источников.

---

## 1. Проблема, которую мы решаем (точка отсчёта)

Производительность кодинга на LМ выросла на порядок: 90% разработчиков пользуются ИИ, медиана — 2 часа в день ([DORA 2025](https://dora.dev/research/2025/dora-report/)). А механизмы доставки стандартов разработки до «рабочих мест» — харнесов (deepseek-harness, pi, opencode, ZCode) — остались ручными: правила живут в вики или в одном-двух инструментах и проверяются пост-фактум, красным CI.

Наша цель (см. [concept.md](concept.md)): стандарты из Git-репозитория → в контекст моделей (AGENTS.md, skills) + детерминированный контроль скриптами **до CI** + возврат замечаний модели «в моменте». Вопрос этого исследования: **как ту же задачу формулируют и решают Anthropic, Google, китайские вендоры и организации — и подтверждает ли это наш концепт?**

---

## 2. Картина целиком: консенсусный стек индустрии

К середине 2026 в источниках складывается пятислойная модель «контроля недетерминированного генератора» — каждый слой добавляет детерминизма:

| Слой | Что это | Примеры (проверено) |
|---|---|---|
| 1. Политика организации | Человеческая ответственность, обязательные правила | Стандарт UK Home Office (MUST-требования); орг-инструкции GitHub Copilot; managed settings Claude Code |
| 2. Контекст-файлы (декларативные стандарты, версионируются в репо) | «README для агентов» | AGENTS.md (60k+ проектов, фонд Linux Foundation), CLAUDE.md, GEMINI.md, rules-директории с globs |
| 3. Процессуальный слой (feedforward) | Скиллы, spec-first пайплайны | Agent Skills (открытый стандарт Anthropic), GitHub Spec Kit, «shared skills database» Notion |
| 4. Детерминированные проверки в петле (feedback, до CI) | Линтеры/SAST/свои валидаторы во время генерации | Semgrep Guardian, hooks Claude Code/ZCode/dsh, ThoughtWorks «feedback controls» |
| 5. CI-гейты и ревью | Последняя линия, required checks | Human review (Home Office: «MUST be reviewed by a human»), mutation testing, CI-агенты |

Ключевой сдвиг 2025–2026: контроль мигрирует **из CI в петлю генерации** (слой 4). ThoughtWorks называет это «putting coding agents on a leash» — поводок из feedforward-контролей (скиллы, спеки) и feedback-контролей, триггерящих самолечение кода до человеческого ревью ([Radar Vol.34, пресс-релиз](https://www.thoughtworks.com/en-us/about-us/news/2026/combat-ai-cognitive-debt-radar-v34)). Semgrep формулирует мотивировку прямо: AppSec-команды видят «10x рост уязвимостей», а CI/CD-сканирование «случается слишком поздно» — их Guardian сканирует AI-код «в момент написания» ([semgrep.dev/blog](https://semgrep.dev/blog/2026/introducing-semgrep-guardian-real-time-security-for-ai-written-code)).

Это в точности наша рамка «поддержка (контекст) + контроль (скрипты в петле) + CI как последняя линия».

---

## 3. Что пишет Anthropic

Anthropic выстроил самую полную лестницу «совет → принуждение → дистрибуция → governance» — и явно проговаривает различие, на котором стоит наш концепт:

> **«Unlike CLAUDE.md instructions which are advisory, hooks are deterministic and guarantee the action happens»** — [Best practices](https://code.claude.com/docs/en/best-practices), [Hooks](https://code.claude.com/docs/en/hooks)

Проверенные элементы модели:

1. **Контекст-файлы (advisory).** Иерархия CLAUDE.md: managed policy («Org-wide, cannot be excluded») → user → project → local; рекурсивная загрузка вверх по дереву; `@import` (до 4 хопов); совет — меньше 200 строк на файл ([memory docs](https://code.claude.com/docs/en/memory)). С сентября 2026 Claude Code читает и **AGENTS.md** напрямую (режим `/config` «Project instructions» — `claude-md-or-agents-md` по умолчанию). Директория `.claude/rules/` поддерживает frontmatter `paths:` с глобами — path-scoped правила.
2. **Skills (открытый стандарт).** SKILL.md-папки с progressive disclosure («loads only the minimal information... keeping Claude fast»); опубликованы «as an open standard for cross-platform portability»; enterprise-админ включает скиллы org-wide, шаринг через version control и плагины ([claude.com/blog/skills](https://claude.com/blog/skills)).
3. **Hooks (детерминированный контроль).** События PreToolUse / PostToolUse / UserPromptSubmit / SessionStart и др.; **exit 2 = блок**, который «не может быть переопределён даже permissionDecision allow»; `additionalContext` — инъекция контекста модели; SessionStart-хук рекомендуют для ре-инъекции стандартов после компакции ([hooks](https://code.claude.com/docs/en/hooks)).
4. **Плагины и маркетплейсы (дистрибуция по git).** «All you need is a git repository... with a properly formatted .claude-plugin/marketplace.json» — орги хостят приватные маркетплейсы, чтобы «distribute approved plugins across your organization» ([plugins](https://code.claude.com/docs/en/plugins), [анонс](https://claude.com/blog/claude-code-plugins)).
5. **Enterprise policy.** Managed settings выше любых пользовательских конфигов: allow/deny пермишены, ограничение моделей, force-enable/disable плагинов ([settings](https://code.claude.com/docs/en/settings)).
6. **Context engineering как дисциплина.** «Smallest possible set of high-signal tokens», «context rot», just-in-time retrieval, компакция, сабагенты ([engineering-блог](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)) — обоснование, почему в контексте — короткий индекс, а детали — в скиллах.
7. **CI-контур.** Headless `claude -p` для линтинга/ревью/триажа; [GitHub Action](https://code.claude.com/docs/en/github-actions) с советом класть в CLAUDE.md «code style guidelines, review criteria».

**Мэтч с нами:** лестница Anthropic — это наш концепт в пределах одной экосистемы: advisory-контекст (AGENTS.md/skills) + deterministic hooks (exit 2 + additionalContext) + git-дистрибуция + CI. Наша петля «в моменте» использует те же семантики, только поверх четырёх харнесов.

---

## 4. Что пишет Google

Google решает то же тремя способами: портативные контекст-файлы, орг-политика как конфиг, и измерение (DORA).

1. **GEMINI.md/AGENTS.md как переносимый артефакт стандарта.** Иерархия global → project → subdirectory, конкатенация в каждый промпт, `@file`-импорты, `/memory show|reload`; имя файла настраивается: `context.fileName: ["AGENTS.md", "GEMINI.md"]` — так Google официально закрыл запрос на AGENTS.md ([docs](https://geminicli.com/docs/cli/gemini-md), [discussion #1471](https://github.com/google-gemini/gemini-cli/discussions/1471)). Async-агент [Jules читает AGENTS.md нативно](https://jules.google/docs) («Keep AGENTS.md up to date»).
2. **Кодинг-стандарты как продукт для ревью.** Gemini Code Assist: `.gemini/styleguide.md` — «natural language description» правил (длина строки 100, Google style docstrings, PEP 484); пер-репо `.gemini/config.yaml` (порог критичности, лимит комментариев); **org-уровень**: «Central custom style guides: define and enforce a single, organization-wide style guide... checked before a human ever sees the PR» — «golden path for code quality... enforced from a central location» ([блог Google Cloud](https://cloud.google.com/blog/products/ai-machine-learning/gemini-code-assist-in-github-for-enterprises), [styleguide docs](https://docs.cloud.google.com/gemini/docs/code-review/style-guide)).
3. **Enterprise-конфиг CLI.** System overrides с финальным приоритетом, allowlist тулов и MCP-серверов, форс песочницы, redaction телеметрии ([enterprise guide](https://geminicli.com/docs/cli/enterprise/)).
4. **DORA — измерение как аргумент.** 2024: рост AI-адопции сопровождался **−1.5% throughput и −7.2% stability**; рецепт — «double down on the fundamentals» (малые батчи, платформа, культура) ([анонс 2024](https://cloud.google.com/blog/products/devops-sre/announcing-the-2024-dora-report)). 2025: 90% адопции, throughput развернулся в плюс, но стабильность и доверие — по-прежнему проблема; центральный тезис: **«AI is a mirror and a multiplier»** — возврат приходит «not from the tools themselves, but from a strategic focus on the underlying organizational system» ([DORA 2025](https://dora.dev/research/2025/dora-report/), [блог Google](https://blog.google/innovation-and-ai/technology/developers-tools/dora-report-2025)).
5. **Внутренний SDLC Google.** 37% acceptance rate автодополнения (~50% символов кода), >8% комментариев ревью закрывается ИИ; принципы внедрения: приоритизация по импакту, «UX так же важна, как качество модели», измерение эффективности ([research.google](https://research.google/blog/ai-in-software-engineering-at-google-progress-and-the-path-ahead)).

**Мэтч с нами:** тезис DORA «ИИ — усилитель организации» — прямое обоснование нашей постановки: без доведения стандартов до рабочих мест ИИ усиливает хаос (−7.2% stability), со стандартами — качество. Org-wide style guide Google — это наш канонический репозиторий стандартов, только у нас он нейтрален к вендору.

---

## 5. Что пишут китайские бренды

Общий вывод: китайские вендоры прошли тот же путь и пришли к той же тройке — **AGENTS.md как слой переносимости, SKILL.md как формат процедурного знания, Claude-совместимые hooks как слой принуждения, git как канал дистрибуции**. Некоторые формулируют стандартизацию явнее западных.

### 5.1 DeepSeek — харнес dsh (наш целевой харнес)

- Философия «**Everything is a Plugin**» на фреймворке Cordis; npm-бандлы + профили ([GitHub](https://github.com/deepseek-ai/deepseek-harness)).
- Читает `AGENTS.md`/`CLAUDE.md` с бюджетом **65 536 байт** — документировано в CLI reference.
- Skills в формате SKILL.md из ранжированных корней, включая `.dsh/skills` (100) и **`.agents/skills` (200)** — конвенцию AGENTS-экосистемы.
- **Hooks = «мосты»**: «reuse shell hooks written for Claude Code or Codex. Point the matching integration at an existing hooks.json» — пакет `hooks-claude-code`.

### 5.2 Z.ai / Zhipu — ZCode (наш целевой харнес, «ADE»)

- Позиционирование: «Agentic Development Environment (ADE)», «ZCode | GLM-5.3 官方 Harness» ([zcode.z.ai](https://zcode.z.ai)).
- AGENTS.md: ровно два файла (`~/.zcode/AGENTS.md` + воркспейс), без `@imports` и обхода дочерних директорий; CLAUDE.md — только одноразовая миграция при онбординге.
- Skills `~/.zcode/skills/<name>/SKILL.md`; hooks — семь событий с глубокой Claude-совместимостью (snake_case-алиасы, `CLAUDE_PLUGIN_ROOT`, чтение `.claude-plugin/plugin.json`, «предзагружен маркетплейс Claude Code»); **проектные hooks игнорируются** (безопасность).
- Плагины/маркетплейсы с source `github`/`git`/`file`/`url`/`npm`; командная дистрибуция — репозиторий с `marketplace.json`; энтерпрайз — «team-managed model channels».

### 5.3 Alibaba — Qwen Code / Qoder

- Qwen Code (форк Gemini CLI): иерархия QWEN.md + **«If your repository already has an AGENTS.md file for other tools, Qwen reads that too»**; **rules-директории с frontmatter `paths:`** — правило «не попадает в промпт, пока тул не тронет файл, подходящий под glob» (явная экономия контекста); **team-memory в репо с git-автосинком**; hooks ([memory](https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/memory.md), [rules](https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/rules.md)).
- Qoder (IDE): rules четырёх режимов (Always / Specific Files / Model Decision / Manual), лимит 100k символов; AGENTS.md-совместимость («при конфликте rules приоритетнее»); явное разграничение: память «не является строгой политикой принуждения — для блокировки используйте permission configuration или Hooks» ([docs.qoder.com](https://docs.qoder.com/user-guide/rules.md)).
- Клиентские кейсы формулируют нашу проблему дословно: «Farewell to "Vibe Coding": Team-Level AI Development Powered by **Harness Governance** and SDD»; «500,000 Lines of Agent-Written Code Entered Production» ([customer cases](https://docs.qoder.com/customer-cases/qoder-case-amap.md)).

### 5.4 ByteDance — Trae / TraeCode

- Самая явная формулировка стандартизации среди всех проверенных вендоров. Назначение правил: «提升效率 / **统一标准** / 保障质量», где 统一标准 = «превратить командные нормы и стандарты проекта в правила, чтобы результат всех членов был согласованным по стилю, структуре и качеству» ([docs.trae.cn](https://docs.trae.cn/ide_rules.md)).
- Rules: global + project `.trae/rules/`; 4 режима активации (`alwaysApply`, `globs`, AI-по-description, manual `#Rule`); вложенность до 3 уровней; пер-директории; отдельный `scene: git_message` для сообщений коммитов; **AGENTS.md двусторонне переносим**: «AGENTS.md, созданный в TraeCode, переиспользуется в других IDE, поддерживающих AGENTS.md, и наоборот».

### 5.5 Прочие

- **Moonshot Kimi CLI**: `/init` генерирует AGENTS.md; скиллы — дословное принятие открытого формата [agentskills.io](https://agentskills.io/) («A skill is a directory containing a SKILL.md»); явное разграничение «Skills = знания через SKILL.md, Plugins = исполняемые тулы через plugin.json» ([GitHub](https://github.com/MoonshotAI/kimi-cli)).
- **Baidu Comate**: правила personal/project («подходят для единых командных стандартов разработки»), нативный формат `.comate/rules/*.mdr`, энтерпрайз-настройки ([docs](https://cloud.baidu.com/doc/COMATE/s/Zm9l4agw3)).
- **Tencent CodeBuddy**: user/project rules + CODEBUDDY.md; AGENTS.md-совместимость — *вторично* ([codebuddy.ai](https://www.codebuddy.ai), доки Tencent Cloud были недоступны из нашей сети).

**Мэтч с нами:** все четыре наших целевых харнеса уже сошлись на одних и тех же поверхностях (AGENTS.md / SKILL.md / Claude-формат hooks / git-дистрибуция) — значит, наш `emit` проецирует не изобретённые нами интерфейсы, а фактический стандарт де-факто. И китайский рынок первым начал продавать «harness governance» как ценность.

---

## 6. Как организации вводят стандартизацию на рабочих местах

- **UK Home Office** — самый чистый публичный орг-стандарт (SEGAS-00020, март 2026): RFC-стиль MUST-требования — AI-выходы «MUST be reviewed and approved by a human before reaching production», трассируемость (маркер `[AI-assisted]`), тот же security-бар, что для человеческого кода; «AI systems are treated as tools and are not considered to be team members» ([engineering.homeoffice.gov.uk](https://engineering.homeoffice.gov.uk/standards/use-ai/), [репо](https://github.com/UKHomeOffice/engineering-guidance-and-standards/blob/main/docs/standards/use-ai.md)).
- **GitHub Copilot**: с августа 2025 coding agent читает AGENTS.md (+ nested) ([changelog 2025-08-28](https://github.blog/changelog/2025-08-28-copilot-coding-agent-now-supports-agents-md-custom-instructions)); с ноября 2025 — **org-level custom instructions**: «Organization admins can set default instructions for all coding agent usage across your organization» ([changelog 2025-11-05](https://github.blog/changelog/2025-11-05-copilot-coding-agent-supports-organization-custom-instructions/)).
- **Cursor / Windsurf**: rules с frontmatter `globs`/`alwaysApply`/`description`; приоритет Team → Project → User; у Windsurf — read-only **System/Enterprise rules, развёртываемые IT** (например, `/etc/windsurf/rules/*.md`) ([cursor docs](https://cursor.com/docs/rules), [windsurf docs](https://docs.devin.ai/desktop/cascade/memories)).
- **Shopify** (меморандум Tobi Lütke, апрель 2025): «Reflexive AI usage is now a baseline expectation» — культурный слой, ИИ в перформанс-вопросах (*вторично*, широко цитируется: [пост в X](https://x.com/tobi/status/1909251946235437514), [First Round](https://www.firstround.com/ai/shopify)).
- **ThoughtWorks Radar Vol.34** (апрель 2026): «cognitive debt» от растущих объёмов AI-кода; рецепт — «practices and technical harnesses», feedforward (Agent Skills, spec-driven development) + feedback (mutation testing, детерминированные проверки, «self-correction before human review»); defense in depth — «non-negotiable table stakes» ([пресс-релиз](https://www.thoughtworks.com/en-us/about-us/news/2026/combat-ai-cognitive-debt-radar-v34)).
- **Platform engineering**: Humanitec поставляет документацию платформы в контекст кодинг-тулов через MCP ([блог](https://humanitec.com/blog/feature-announcement-mcp-knowledge-server)); Backstage golden paths — канонический механизм раздачи стандартов, но **документированного паттерна «AGENTS.md в шаблоне проекта» ещё нет** — практика emerging ([backstage docs](https://backstage.io/docs/features/software-templates/)).
- **Инфраструктура стандарта**: AGENTS.md передан OpenAI в [Agentic AI Foundation под эгидой Linux Foundation](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation) (декабрь 2025; сооснователи: Anthropic — MCP, Block — goose, OpenAI — AGENTS.md; платина — AWS, Google, Microsoft, Anthropic, OpenAI; золото — Shopify, JetBrains, Datadog). Заявление OpenAI — [openai.com/index/agentic-ai-foundation](https://openai.com/index/agentic-ai-foundation/). «60,000+ open-source projects use it» ([agents.md](https://agents.md)); траекторию роста фиксировала [InfoQ, авг. 2025](https://www.infoq.com/news/2025/08/agents-md).

---

## 7. Сходимость: один и тот же паттерн у всех

| Механизм | Anthropic | Google | Китайские | Наш concept.md |
|---|---|---|---|---|
| Переносимый контекст-файл | CLAUDE.md + AGENTS.md (fallback) | GEMINI.md, настраивается на AGENTS.md; Jules — нативно | AGENTS.md у всех терминальных | managed-блок AGENTS.md — общий знаменатель 4 харнесов |
| Path-scoped правила | `.claude/rules/` + `paths:` | rules Qwen (`paths:`) | Trae/Qoder/Comate (`globs`) | маппинг `paths:` в манифесте — на уровень выше: путь → **скрипт-проверки** |
| Скиллы как процедуры | Agent Skills (открытый стандарт) | — (у Jules нет) | SKILL.md у ZCode/dsh/Qwen/Kimi | skills-проекции из канонического репо |
| Детерминированный контроль в петле | hooks: exit 2 = блок, additionalContext | hooks у Qwen/Qoder; permission config | ZCode — Claude-протокол; dsh — мост hooks-claude-code | те же семантики: `check --changed` → ✗-список в контекст, exit 2 для критичных |
| Дистрибуция по git | маркетплейсы = git-репо | — | ZCode marketplace `git`/`github`; pi `git:`-пакеты | `standards pull` из канонического репо |
| Org-слой | managed settings («cannot be excluded») | org-wide style guide, system overrides | enterprise settings Comate, каналы ZCode | у наших харнесов слабее — пишем в user-конфиги, гарантию даёт CI |
| Разделение advisory/deterministic | проговорено дословно | Qoder CLI проговорил дословно | да | ядро концепта: `enforcement: script \| model \| hybrid` в манифесте |

---

## 8. Пробелы рынка (что никто не закрыл)

Проверенные источники сходятся в том, чего в экосистеме нет:

1. **Кросс-инструментная консистентность.** У AGENTS.md нет схемы, медия-типа и версионирования; оргы должны синхронизировать AGENTS.md и нативные rule-файлы руками. Активационная семантика (globs, лимиты, вложенность) у каждого тула своя.
2. **Портативность enforcement.** Портативного стандарта на hooks между агентами нет; детерминированные проверки в петле зависят от вендора; продукты уровня Semgrep Guardian проприетарны даже там, где правила — это код.
3. **Версионирование и provenance стандартов.** Ни один вендор не фиксирует, **по какой версии стандартов** работал агент в конкретном PR.
4. **Единый источник для разных харнесов.** Орг-инструкции Copilot, managed settings Claude, style guide Google, rules Trae — каждый вендор решает для своей экосистемы. Публичного паттерна «один канонический репо стандартов → проекции во все инструменты команды» не найдено; ближайшие аналоги — приватные маркетплейсы плагинов (одна экосистема) и golden paths Backstage (пока без документированного AGENTS.md-паттерна).

---

## 9. Мэтч с concept.md: подтверждения, отличия, корректировки

### 9.1 Что индустрия подтверждает (по пунктам концепта)

- **AGENTS.md как несущая проекция** — консенсус: 60k+ проектов, LF/AAIF, читают все 4 наших харнеса и все крупные вендоры. Выбор долгосрочный (передача в фонд — сигнал стабильности).
- **Skills как слой деталей** — открытый стандарт Anthropic принят ZCode, dsh, Qwen, Kimi; progressive disclosure закрывает наш риск с лимитом dsh 64 КБ (индекс в AGENTS.md, детали в скиллах — ровно совет Anthropic «under 200 lines»).
- **Разделение advisory vs deterministic** — Anthropic и Qoder формулируют его дословно; наш манифест `enforcement: script | model | hybrid` превращает их философию в данные.
- **Петля «в моменте» (слой до CI)** — направление рынка 2026: Semgrep («CI happens too late»), ThoughtWorks (feedback controls, self-correction before human review). Мы делаем то же, но на открытом стеке и со своими стандартами.
- **Claude-формат hooks как lingua franca принуждения** — ZCode реализует протокол Claude, dsh поставляет мост, opencode — плагины; наш единый hooks.json на три харнеса — фактический стандарт де-факто (четвёртый, pi, закрыт extension-событиями — обоснованно, MCP у него нет).
- **Git как канал дистрибуции стандартов** — маркетплейсы Claude/ZCode и пакеты pi уже работают через git; наш `pull` из канонического репо — та же модель, вынесенная на уровень нейтрального инструмента.
- **Постановка «ИИ — усилитель»** (DORA) — объясняет, зачем всё это: без доставки стандартов ИИ усиливает разброс (−7.2% stability в 2024), с платформой и стандартами — даёт возврат (разворот throughput в 2025).

### 9.2 Чем мы отличаемся (наши ставки поверх тренда)

1. **Нейтральность к вендору**: один канонический репо + `emit` в 4 харнеса закрывает пробел №4 — вендоры не будут решать задачу для чужих харнесов, AAIF стандартизует файл, но не доставку и не enforcement.
2. **Манифест script/model как данные** — вендоры предлагают «правила-в-контексте + hooks руками»; связку «одно правило декларирует и guidance, и скрипт-проверку с glob-маппингом» не декларировал никто (path-scoped rules существуют, но активируют текст, а не проверку).
3. **Lock-файл версии стандартов + сверка в CI** — прямой ответ на пробел №3 (provenance), аналога у вендоров не найдено.
4. **Открытый стек вместо проприетарных guardian-продуктов** — наши проверки это OSS (spectral, oasdiff) + zero-dep скрипты (контракт rationaldev): дешевле и аудируемее для внутреннего стандарта организации.

### 9.3 Корректировки концепта, напрашивающиеся из исследования

- **Кандидаты в фазу 3+:** eval скиллов в CI по образцу `claude plugin eval`; трассируемость `[AI-assisted]` (Home Office) — дёшево добавить в managed-блок AGENTS.md; орг-слой у нас заменяют канонический репо + CI-политика свежести lock-файла.
- **Не переносим:** path-scoped rules-директории как отдельная проекция — у наших 4 харнесов этой поверхности нет (dsh/ZCode rules-директории не читают); их функцию выполняет маппинг `paths:` → hooks. MCP-сервер правил уже отклонён ранее (pi без MCP, контроль опционален) — исследование подтвердило: Anthropic двигает MCP для code execution, а не для доставки правил.
- **Риск подтвердился:** проектные hooks игнорируются ZCode, enterprise-механизмов «выше пользователя» в наших харнесах нет — единственная гарантия остаётся CI + branch protection, как зафиксировано в concept.md (§8 «модель угроз»). Ставка не изменилась, а усилилась.

---

## 10. Вывод (наратив замкнут)

Индустрия прошла за 2025–2026 путь от «дадим агенту CLAUDE.md» к пятиуровневой модели: орг-политика → контекст-файлы → скиллы/спеки → **детерминированные проверки в петле генерации** → CI и ревью. Anthropic построила эту лестницу внутри своей экосистемы и открыла форматы (Skills, hooks-семантики, маркетплейсы по git); Google добавил орг-политику и измерение (DORA: «ИИ — усилитель организации; возврат даёт система, а не тулзы»); китайские вендоры — включая оба наших целевых харнеса, dsh и ZCode — приняли те же поверхности и первыми стали продавать «harness governance»; организации переводят политику в MUST-требования и орг-инструкции.

При этом проверенно не закрыто: **доставка одного набора стандартов в разнородные харнесы команды и версионируемый детерминированный контроль до CI** — вендоры решают каждый для себя, портативного слоя нет. Именно этот пробел занимает standards-CLI из [concept.md](concept.md): канонический репо стандартов (git) → проекции AGENTS.md/skills/hooks в 4 харнеса → скрипт-проверки в петле (`--changed`) и до CI (`--staged`, CI) → lock-файл для прозрачности. Концепт не плывёт против рынка — он собирает уже победившие паттерны в нейтральный к вендору инструмент, что и требовалось доказать.

---

## 11. Источники (полный список)

Пометка **[вторично]** — страницу не удалось открыть напрямую, факт взят из цитирующих её источников.

### Индустрия и аналитика

- ThoughtWorks Technology Radar Vol.34 — «Combat AI cognitive debt» (пресс-релиз, апрель 2026): <https://www.thoughtworks.com/en-us/about-us/news/2026/combat-ai-cognitive-debt-radar-v34>
- Semgrep Guardian — «Real-time security for AI-written code» (июнь 2026): <https://semgrep.dev/blog/2026/introducing-semgrep-guardian-real-time-security-for-ai-written-code>
- Semgrep — «Security skills for AI agents»: <https://semgrep.dev/blog/2026/security-skills-ai-agents>
- «Use Deterministic Guardrails for Your LLM Agents» (практика линтеров для агентного кода, янв. 2026): <https://www.balajeerc.info/use-deterministic-guardrails-for-your-llm-agents/>
- LangChain — «The Rise of Context Engineering» (Harrison Chase, июнь 2025): <https://www.langchain.com/blog/the-rise-of-context-engineering>
- Simon Willison — «Context engineering» (июнь 2025): <https://simonwillison.net/2025/Jun/27/context-engineering/>
- GitHub Spec Kit — spec-driven development toolkit: <https://github.com/github/spec-kit>; анонс: <https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit>

### Anthropic

- «Claude Code: Best practices for agentic coding»: <https://code.claude.com/docs/en/best-practices> (оригинал 2025: <https://www.anthropic.com/engineering/claude-code-best-practices>)
- «Building effective agents» (дек. 2024): <https://www.anthropic.com/engineering/building-effective-agents>
- «Effective context engineering for AI agents» (сент. 2025): <https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>
- Memory / CLAUDE.md / AGENTS.md / `.claude/rules/`: <https://code.claude.com/docs/en/memory>
- Hooks (события, exit 2, additionalContext): <https://code.claude.com/docs/en/hooks>; гайд: <https://code.claude.com/docs/en/hooks-guide>
- Agent Skills — открытый стандарт (анонс окт. 2025): <https://claude.com/blog/skills>; пример-репо: <https://github.com/anthropics/skills>
- Plugins и маркетплейсы: <https://code.claude.com/docs/en/plugins>; анонс: <https://claude.com/blog/claude-code-plugins>
- Settings и enterprise-политика: <https://code.claude.com/docs/en/settings>; managed settings: <https://code.claude.com/docs/en/managed-settings>
- GitHub Actions для Claude Code: <https://code.claude.com/docs/en/github-actions>
- Кейсы клиентов: хаб <https://claude.com/customers>; GitLab <https://claude.com/customers/gitlab>; Notion <https://claude.com/customers/notion>

### Google

- Gemini CLI — GEMINI.md (иерархия, `@`-импорты, `/memory`): <https://geminicli.com/docs/cli/gemini-md>
- Gemini CLI — конфигурация (`context.fileName`): <https://geminicli.com/docs/reference/configuration>
- Gemini CLI — обсуждение AGENTS.md (#1471): <https://github.com/google-gemini/gemini-cli/discussions/1471>
- Gemini CLI — enterprise guide (system overrides, allowlist, песочница): <https://geminicli.com/docs/cli/enterprise/>; песочница: <https://geminicli.com/docs/cli/sandbox/>
- Jules — docs (AGENTS.md нативно): <https://jules.google/docs>
- Gemini Code Assist — agentic-режим (GEMINI.md): <https://docs.cloud.google.com/gemini/docs/codeassist/use-agentic-chat-pair-programmer>
- Gemini Code Assist — style guide для ревью (`.gemini/styleguide.md`): <https://docs.cloud.google.com/gemini/docs/code-review/style-guide>
- Gemini Code Assist — настройка ревью (`config.yaml`): <https://docs.cloud.google.com/gemini/docs/code-review/customize-repo-review>
- Gemini Code Assist for enterprises — org-wide style guide (блог, окт. 2025): <https://cloud.google.com/blog/products/ai-machine-learning/gemini-code-assist-in-github-for-enterprises>
- DORA 2024 (анонс, окт. 2024): <https://cloud.google.com/blog/products/devops/sre/announcing-the-2024-dora-report>
- DORA 2025: отчёт <https://dora.dev/research/2025/dora-report/>; блог Google <https://blog.google/innovation-and-ai/technology/developers-tools/dora-report-2025>
- «AI in Software Engineering at Google» (research.google, июнь 2024): <https://research.google/blog/ai-in-software-engineering-at-google-progress-and-the-path-ahead>

### Китайские вендоры

- DeepSeek Harness (dsh): репо <https://github.com/deepseek-ai/deepseek-harness>; npm <https://registry.npmjs.org/@deepseek-ai/dsh>; доки <https://deepseek-harness.github.io/deepseek-harness/>
- ZCode (Z.ai / Zhipu): AGENTS.md <https://zcode.z.ai/en/docs/agents>; hooks <https://zcode.z.ai/en/docs/hooks>; skills <https://zcode.z.ai/en/docs/skill>; plugins <https://zcode.z.ai/en/docs/plugin>; FAQ <https://zcode.z.ai/en/docs/qa>; GLM Coding Plan <https://docs.z.ai>
- Qwen Code: репо <https://github.com/QwenLM/qwen-code>; memory <https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/memory.md>; rules <https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/rules.md>; skills <https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/skills.md>
- Qoder: rules <https://docs.qoder.com/user-guide/rules.md>; CLI memory <https://docs.qoder.com/cli/memory.md>
- Qoder — кейсы: AMAP «Farewell to Vibe Coding» <https://docs.qoder.com/customer-cases/qoder-case-amap.md>; «500,000 Lines of Agent-Written Code» <https://docs.qoder.com/customer-cases/qoder-case-50agent.md>; UU Paotui <https://docs.qoder.com/customer-cases/qoder-case-uu.md>
- Trae / TraeCode: rules (CN) <https://docs.trae.cn/ide_rules.md>; rules (EN) <https://docs.trae.ai/docs/rules>; индекс док <https://docs.trae.cn/llms.txt>
- Moonshot Kimi CLI: <https://github.com/MoonshotAI/kimi-cli>
- Agent Skills — открытый формат (цитируется Kimi): <https://agentskills.io/>
- Baidu Comate — правила: <https://cloud.baidu.com/doc/COMATE/s/Zm9l4agw3>; энтерпрайз-настройки <https://cloud.baidu.com/doc/COMATE/s/Wmk2en25r>
- Tencent CodeBuddy — **[вторично]**: <https://www.codebuddy.ai>

### Организации и стандарты

- AGENTS.md — сайт стандарта: <https://agents.md>
- Linux Foundation — создание Agentic AI Foundation (дек. 2025): <https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation>
- OpenAI — «Agentic AI Foundation» (о передаче AGENTS.md): <https://openai.com/index/agentic-ai-foundation/>
- InfoQ — «AGENTS.md» (авг. 2025): <https://www.infoq.com/news/2025/08/agents-md>
- UK Home Office — стандарт «Use AI» (SEGAS-00020): <https://engineering.homeoffice.gov.uk/standards/use-ai/>; исходник <https://github.com/UKHomeOffice/engineering-guidance-and-standards/blob/main/docs/standards/use-ai.md>
- GitHub Copilot — coding agent + AGENTS.md (авг. 2025): <https://github.blog/changelog/2025-08-28-copilot-coding-agent-now-supports-agents-md-custom-instructions>
- GitHub Copilot — org-level custom instructions (нояб. 2025): <https://github.blog/changelog/2025-11-05-copilot-coding-agent-supports-organization-custom-instructions/>
- Cursor — rules docs (`.mdc`, `globs`, `alwaysApply`): <https://cursor.com/docs/rules>
- Windsurf — memories/rules (включая IT-deployed System rules): <https://docs.devin.ai/desktop/cascade/memories>
- Shopify — меморандум Tobi Lütke — **[вторично]**: <https://x.com/tobi/status/1909251946235437514>; разбор First Round: <https://www.firstround.com/ai/shopify>
- Humanitec — MCP knowledge server: <https://humanitec.com/blog/feature-announcement-mcp-knowledge-server>
- Backstage — software templates (golden paths): <https://backstage.io/docs/features/software-templates/>

### Локальная фактбаза (проверено по исходникам, лежит в основе concept.md)

- deepseek-harness (исходники dsh): `~/IdeaProjects/codemonstersdev/deepseek-harness` — `packages/context/agent-instructions`, `packages/hooks/hooks-claude-code`, `packages/skill/skill-filesystem`
- pi (доки установленного пакета): `~/IdeaProjects/codemonstersdev/pi-extensible-workflows/node_modules/@earendil-works/pi-coding-agent/docs/` — `extensions.md`, `packages.md`, `usage.md`
- rationaldev-ai-sdlc-skills (32 скилла + 17 валидаторов): `~/IdeaProjects/codemonstersdev/rationaldev-ai-sdlc-skills`; GitHub: <https://github.com/codemonstersteam/rationaldev-ai-sdlc-skills>
- pinout-openapi (сервис, разработанный по стандартам): `~/IdeaProjects/codemonstersdev/pinout/pinout-openapi`; GitHub: <https://github.com/codemonstersteam/pinout-openapi>
- Полный перечень локальных проверок с путями до файлов — [concept.md](concept.md), раздел «Фактическая база».

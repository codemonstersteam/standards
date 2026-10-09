#!/usr/bin/env node
// Прогон всех проверок MVP: чекеры на фикстурах, hook на эмуляции stdin,
// opencode-плагин напрямую, install.sh во временный каталог с подменным HOME.
// Запуск: node test/run.mjs   (exit 0 = всё зелёное)
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))) // test/ -> репо
const FIX = (...p) => join(ROOT, 'test', 'fixtures', ...p)

let failed = 0
let passed = 0
function ok(cond, name, extra = '') {
  if (cond) {
    passed++
    console.log(`PASS — ${name}`)
  } else {
    failed++
    console.log(`FAIL — ${name}${extra ? `\n      ${extra}` : ''}`)
  }
}
function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...opts })
}
const count = (s, needle) => s.split(needle).length - 1

// ---------- 0. Мини-YAML-парсер (lib/yaml.mjs) ----------
{
  const { parseYaml } = await import(pathToFileURL(join(ROOT, 'lib', 'yaml.mjs')))

  const basic = parseYaml(
    [
      'version: 0.4.0          # комментарий',
      'count: 42',
      'flag: true',
      'nothing: null',
      'name: box-spec',
      '"quoted:key": v',
      'order: [b, "c d", 7]',
      'empty: []',
    ].join('\n')
  )
  ok(
    basic.version === '0.4.0' && basic.count === 42 && basic.flag === true && basic.nothing === null,
    'yaml: скаляры (строка/число/bool/null), комментарий снят'
  )
  ok(basic['quoted:key'] === 'v', 'yaml: ключ в кавычках с двоеточием')
  ok(
    Array.isArray(basic.order) && basic.order[1] === 'c d' && basic.order[2] === 7 && basic.empty.length === 0,
    'yaml: inline-списки (в т.ч. пустой)'
  )

  const nested = parseYaml(
    [
      'rule_groups:',
      '  hard:',
      '    heading: "## Hard rules"',
      '    items:',
      '      - один',
      '      - |',
      '        две',
      '        строки',
      'checks:',
      '  - check: check-api-spec',
      '    paths: ["a/**"]',
      '    severity: warn',
      '  - check: check-docs',
      '    severity: warn',
    ].join('\n')
  )
  ok(
    nested.rule_groups.hard.heading === '## Hard rules' && nested.rule_groups.hard.items[0] === 'один',
    'yaml: вложенные map + список строк'
  )
  ok(nested.rule_groups.hard.items[1] === 'две\nстроки\n', 'yaml: block scalar | (с конечным \\n)')
  ok(
    nested.checks[0].paths[0] === 'a/**' && nested.checks[1].severity === 'warn' && nested.checks[1].paths === undefined,
    'yaml: список map-элементов с продолжением на следующих строках'
  )

  const folded = parseYaml('desc: >-\n  одна\n  строка\n\n  новый абзац\n')
  ok(folded.desc === 'одна строка\nновый абзац', 'yaml: >- сворачивает переносы, пустая строка = абзац')

  ok(parseYaml('---\n# комментарий\na: 1\n...\n').a === 1, 'yaml: --- и строка-комментарий пропускаются')

  let threw = 0
  try {
    parseYaml('a:\n\tb: 1')
  } catch {
    threw++
  }
  try {
    parseYaml('просто строка')
  } catch {
    threw++
  }
  try {
    parseYaml('a: 1\n  b: 2')
  } catch {
    threw++
  }
  ok(threw === 3, 'yaml: fail-closed (таб в отступе / не-ключ / лишний отступ)')
}

// ---------- 0b. Генератор артефактов из rules/ (tools/generate.mjs) ----------
{
  const gen = run('node', [join(ROOT, 'tools', 'generate.mjs')])
  ok(gen.status === 0, 'generate: прогон exit 0', gen.stderr)

  const check = run('node', [join(ROOT, 'tools', 'generate.mjs'), '--check'])
  ok(check.status === 0 && check.stdout.includes('OK'), 'generate --check: артефакты свежи', check.stdout + check.stderr)

  const box = readFileSync(join(ROOT, 'skills', 'box-spec', 'SKILL.md'), 'utf8')
  ok(
    box.startsWith('---\nname: box-spec\n') && box.includes('## Hard rules') && box.includes('## STOP') && box.includes('x-frozen'),
    'generate: SKILL.md собран (frontmatter, правила, STOP, контент правил)'
  )
  ok(box.includes('generated from rules/box-spec sha256:'), 'generate: штамп provenance в SKILL.md')

  const tbd = readFileSync(join(ROOT, 'skills', 'tbd', 'SKILL.md'), 'utf8')
  ok(
    tbd.includes('## Что проверяет скрипт (check-tbd)') && tbd.includes('- коммит напрямую в trunk/main/master — запрещено;'),
    'generate: секция «что проверяет» выводится из meta чекера'
  )

  const release = readFileSync(join(ROOT, 'skills', 'release', 'SKILL.md'), 'utf8')
  ok(
    release.includes('## SemVer: вес = совместимость') && release.includes('## Feature toggles') && release.includes('Ничего (guidance)'),
    'generate: группы правил release + guidance-текст при пустых checks'
  )

  const manifest = JSON.parse(readFileSync(join(ROOT, 'standards.json'), 'utf8'))
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  ok(
    manifest.standards.length === 5 &&
      manifest.standards.map((s) => s.id).join(',') === 'box-spec,component-tests,modules,tbd,release',
    'generate: манифест — 5 стандартов в порядке order из meta.yaml'
  )
  ok(
    manifest.version === pkg.version,
    'generate: версии манифеста и package.json из одного источника (rules/meta.yaml)'
  )
  ok(box.includes('dev-standards@v'), 'generate: штамп содержит версию dev-standards@')

  const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8')
  ok(
    agents.includes('dev-standards:skills:start v1') && agents.includes('dev-standards:skills:end v1') && agents.includes('`release`'),
    'generate: footer AGENTS.md — managed-блок v1 со списком скиллов'
  )

  // --list: сухой прогон, ничего не пишет
  const ls = run('node', [join(ROOT, 'tools', 'generate.mjs'), '--list'])
  ok(
    ls.status === 0 && ls.stdout.includes('skills/tbd/SKILL.md (fresh)') && ls.stdout.includes('standards.json (fresh)'),
    'generate --list: план артефактов, fresh-статусы',
    ls.stdout
  )

  // миграция: старые маркеры без версии нормализуются на v1
  const agentsPath = join(ROOT, 'AGENTS.md')
  const agentsOriginal = readFileSync(agentsPath, 'utf8')
  try {
    writeFileSync(
      agentsPath,
      agentsOriginal
        .replaceAll('dev-standards:skills:start v1', 'dev-standards:skills:start')
        .replaceAll('dev-standards:skills:end v1', 'dev-standards:skills:end')
    )
    run('node', [join(ROOT, 'tools', 'generate.mjs')])
    ok(
      readFileSync(agentsPath, 'utf8').includes('dev-standards:skills:start v1'),
      'generate: мигрирует старые маркеры (без версии) на v1'
    )
  } finally {
    writeFileSync(agentsPath, agentsOriginal)
  }

  // --clean: удаляет артефакты-владельцы и вырезает блок; generate восстанавливает
  const clean = run('node', [join(ROOT, 'tools', 'generate.mjs'), '--clean'])
  ok(
    clean.status === 0 &&
      !existsSync(join(ROOT, 'standards.json')) &&
      !existsSync(join(ROOT, 'skills', 'tbd', 'SKILL.md')),
    'generate --clean: удаляет standards.json и SKILL.md',
    clean.stdout + clean.stderr
  )
  ok(
    !readFileSync(agentsPath, 'utf8').includes('dev-standards:skills:'),
    'generate --clean: вырезает skills-блок из AGENTS.md'
  )
  run('node', [join(ROOT, 'tools', 'generate.mjs')])
  ok(
    run('node', [join(ROOT, 'tools', 'generate.mjs'), '--check']).status === 0,
    'generate: после clean + generate всё восстановлено'
  )

  // ручная правка сгенерённого артефакта ловится --check и видна в --list
  const skillPath = join(ROOT, 'skills', 'tbd', 'SKILL.md')
  const original = readFileSync(skillPath, 'utf8')
  try {
    writeFileSync(skillPath, original + 'ручная правка\n')
    const stale = run('node', [join(ROOT, 'tools', 'generate.mjs'), '--check'])
    ok(
      stale.status === 1 && stale.stderr.includes('skills/tbd/SKILL.md'),
      'generate --check: ловит ручную правку артефакта',
      stale.stderr
    )
    const lsStale = run('node', [join(ROOT, 'tools', 'generate.mjs'), '--list'])
    ok(
      lsStale.status === 0 && lsStale.stdout.includes('skills/tbd/SKILL.md (would update)'),
      'generate --list: устаревший артефакт помечен would update',
      lsStale.stdout
    )
  } finally {
    writeFileSync(skillPath, original)
  }
  ok(run('node', [join(ROOT, 'tools', 'generate.mjs'), '--check']).status === 0, 'generate --check: после восстановления — свежи')

  // правка rules/ меняет артефакт: источник один
  const rulePath = join(ROOT, 'rules', 'tbd', 'rule.yaml')
  const ruleOriginal = readFileSync(rulePath, 'utf8')
  try {
    writeFileSync(rulePath, ruleOriginal.replace('summary: Trunk-Based Development', 'summary: Trunk-Based Development (тест)'))
    run('node', [join(ROOT, 'tools', 'generate.mjs')])
    ok(
      readFileSync(join(ROOT, 'standards.json'), 'utf8').includes('Trunk-Based Development (тест)'),
      'generate: правка rules/ меняет манифест (правки только в источнике)'
    )
  } finally {
    writeFileSync(rulePath, ruleOriginal)
    run('node', [join(ROOT, 'tools', 'generate.mjs')])
  }

  // чекеры отдают своё описание (--meta)
  const m = run('node', [join(ROOT, 'checks', 'check-tbd.mjs'), '--meta'])
  let parsedMeta = null
  try {
    parsedMeta = JSON.parse(m.stdout)
  } catch {}
  ok(
    m.status === 0 && Array.isArray(parsedMeta?.what) && parsedMeta.what.length === 3 && typeof parsedMeta.notes === 'string',
    'check --meta: JSON с what[] и notes'
  )
}

// ---------- 1. Чекеры на фикстурах ----------
{
  const goodApi = run('node', [join(ROOT, 'checks', 'check-api-spec.mjs'), FIX('good')])
  ok(goodApi.status === 0 && goodApi.stdout.includes('OK'), 'check-api-spec: good → exit 0 + OK', goodApi.stderr)

  const badApi = run('node', [join(ROOT, 'checks', 'check-api-spec.mjs'), FIX('bad')])
  ok(badApi.status === 1, 'check-api-spec: bad → exit 1', badApi.stderr)
  ok(badApi.stderr.includes('x-frozen'), 'check-api-spec: bad упоминает x-frozen')
  ok(badApi.stderr.includes('paths'), 'check-api-spec: bad упоминает paths')
  ok(badApi.stderr.includes('✗'), 'check-api-spec: bad выводит ✗-строки')

  const goodCt = run('node', [join(ROOT, 'checks', 'check-component-tests.mjs'), FIX('good')])
  ok(goodCt.status === 0 && goodCt.stdout.includes('N=2'), 'check-component-tests: good → exit 0, N=2', goodCt.stderr + goodCt.stdout)

  const badCt = run('node', [join(ROOT, 'checks', 'check-component-tests.mjs'), FIX('bad')])
  ok(badCt.status === 1, 'check-component-tests: bad → exit 1', badCt.stderr)
  ok(badCt.stderr.includes('@wip'), 'check-component-tests: bad упоминает @wip')
  ok(badCt.stderr.includes('smoke'), 'check-component-tests: bad упоминает smoke')
  ok(badCt.stderr.includes('N=6'), 'check-component-tests: bad сверяет N=6', badCt.stderr)
  ok(badCt.stderr.includes('happy path» встречается 2'), 'check-component-tests: bad ловит дубль названия')
}

// ---------- 1b. Новые стандарты: modules, tbd, run-all ----------
{
  const goodMod = run('node', [join(ROOT, 'checks', 'check-modules.mjs'), FIX('good')])
  ok(goodMod.status === 0 && goodMod.stdout.includes('2 модулей'), 'check-modules: good → exit 0', goodMod.stderr + goodMod.stdout)

  const badMod = run('node', [join(ROOT, 'checks', 'check-modules.mjs'), FIX('bad')])
  ok(badMod.status === 1, 'check-modules: bad → exit 1', badMod.stderr)
  ok(badMod.stderr.includes('2 точки входа') && badMod.stderr.includes('payments'), 'check-modules: bad ловит два входа')
  ok(badMod.stderr.includes('legacy') && badMod.stderr.includes('нет точки входа'), 'check-modules: bad ловит отсутствие входа')

  const noGit = run('node', [join(ROOT, 'checks', 'check-tbd.mjs'), FIX('good')])
  ok(noGit.status === 0 && noGit.stdout.includes('пропущена'), 'check-tbd: не git-репозиторий → OK skip', noGit.stdout)

  // реальный git-репозиторий: коммит в main; старая большая feature-ветка; hook на git commit
  const grepo = mkdtempSync(join(tmpdir(), 'dev-standards-git-'))
  try {
    const gcommit = (msg, extraEnv = {}) =>
      run('git', ['-C', grepo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', msg], {
        env: { ...process.env, ...extraEnv },
      })
    run('git', ['init', '-q', '-b', 'main', grepo])
    writeFileSync(join(grepo, 'base.txt'), 'base\n')
    run('git', ['-C', grepo, 'add', '.'])
    gcommit('base')

    // greenfield: ровно один коммит — bootstrap-коммит на trunk легален
    const gf = run('node', [join(ROOT, 'checks', 'check-tbd.mjs'), grepo])
    ok(gf.status === 0, 'check-tbd: greenfield (1 коммит) → OK', gf.stderr)

    // второй коммит — репозиторий больше не greenfield, правило trunk-коммита активно
    writeFileSync(join(grepo, 'second.txt'), 'second\n')
    run('git', ['-C', grepo, 'add', '.'])
    gcommit('second')

    const onTrunk = run('node', [join(ROOT, 'checks', 'check-tbd.mjs'), grepo])
    ok(onTrunk.status === 1 && onTrunk.stderr.includes('напрямую в `main`'), 'check-tbd: коммит в main → ✗', onTrunk.stderr)

    run('git', ['-C', grepo, 'checkout', '-q', '-b', 'feat/big-old'])
    writeFileSync(join(grepo, 'big.txt'), 'x\n'.repeat(650))
    run('git', ['-C', grepo, 'add', '.'])
    const oldDate = new Date(Date.now() - 5 * 86400000).toISOString()
    gcommit('big', { GIT_AUTHOR_DATE: oldDate, GIT_COMMITTER_DATE: oldDate })

    const feat = run('node', [join(ROOT, 'checks', 'check-tbd.mjs'), grepo])
    ok(feat.status === 1 && feat.stderr.includes('> 600'), 'check-tbd: дифф > 600 строк → ✗', feat.stderr)
    ok(feat.stderr.includes('дн. > 2'), 'check-tbd: ветка старше 2 дней → ✗', feat.stderr)

    // hook ловит `git commit` в bash-команде и возвращает [tbd]-замечания
    const tbdHook = run('node', [join(ROOT, 'hooks', 'standards-post-tool.mjs')], {
      input: JSON.stringify({ cwd: grepo, tool_name: 'bash', tool_input: { command: 'git commit -m test' } }),
    })
    let parsedTbd = null
    try {
      parsedTbd = JSON.parse(tbdHook.stdout)
    } catch {}
    ok(
      tbdHook.status === 0 &&
        (parsedTbd?.hookSpecificOutput?.additionalContext || '').includes('[tbd]'),
      'hook: git commit в bash → [tbd]-замечания модели',
      tbdHook.stdout + tbdHook.stderr
    )
  } finally {
    rmSync(grepo, { recursive: true, force: true })
  }

  const allBad = run('node', [join(ROOT, 'checks', 'run-all.mjs'), FIX('bad')])
  ok(allBad.status === 1, 'run-all: bad strict → exit 1 (по [error]-дублям)', allBad.stderr)
  ok(
    allBad.stderr.includes('[box-spec]') && allBad.stderr.includes('[component-tests]') && allBad.stderr.includes('[modules]'),
    'run-all: сводит нарушения всех стандартов'
  )
  const allGood = run('node', [join(ROOT, 'checks', 'run-all.mjs'), FIX('good')])
  ok(allGood.status === 0, 'run-all: good strict → exit 0', allGood.stderr + allGood.stdout)
  const allBadReport = run('node', [join(ROOT, 'checks', 'run-all.mjs'), FIX('bad'), '--report'])
  ok(allBadReport.status === 0, 'run-all: bad --report → всегда exit 0', allBadReport.stderr)
}

// ---------- 1b'. Прогрессивные проверки: docs, constructors ----------
{
  const goodDocs = run('node', [join(ROOT, 'checks', 'check-docs.mjs'), FIX('good')])
  ok(goodDocs.status === 0 && goodDocs.stdout.includes('pipe-описание'), 'check-docs: good → exit 0', goodDocs.stderr)

  const badDocs = run('node', [join(ROOT, 'checks', 'check-docs.mjs'), FIX('bad')])
  ok(badDocs.status === 1 && badDocs.stderr.includes('README.md не найден'), 'check-docs: bad (нет README) → exit 1', badDocs.stderr)

  const noContract = run('node', [join(ROOT, 'checks', 'check-docs.mjs'), FIX('go-good')])
  ok(noContract.status === 0 && noContract.stdout.includes('пропущена'), 'check-docs: без контракта → skip')

  const goGood = run('node', [join(ROOT, 'checks', 'check-constructors.mjs'), '.', '--files', FIX('go-good', 'items.go')])
  ok(goGood.status === 0, 'check-constructors: good-фабрика → exit 0', goGood.stderr + goGood.stdout)

  const goBad = run('node', [join(ROOT, 'checks', 'check-constructors.mjs'), '.', '--files', FIX('go-bad', 'payments.go')])
  ok(goBad.status === 1, 'check-constructors: bad → exit 1', goBad.stderr)
  ok(goBad.stderr.includes('не проверяет вход'), 'check-constructors: ловит фабрику без проверки')
  ok(goBad.stderr.includes('«голый» литерал'), 'check-constructors: ловит литерал вне фабрики')

  const nogo = run('node', [join(ROOT, 'checks', 'check-constructors.mjs'), FIX('good')])
  ok(nogo.status === 0 && nogo.stdout.includes('пропущена'), 'check-constructors: нет Go-файлов → skip')
}

// ---------- 1c. pi-расширение (extension-API: tool_result) ----------
{
  const mod = await import(pathToFileURL(join(ROOT, 'pi-extension', 'index.mjs')))
  ok(typeof mod.default === 'function', 'pi-extension: экспортирует register(pi)')
  const handlers = {}
  mod.default({ on: (ev, fn) => { handlers[ev] = fn } })
  ok(typeof handlers['tool_result'] === 'function', 'pi-extension: подписан на tool_result')

  const prevCwd = process.cwd()
  process.chdir(FIX('bad'))
  try {
    const patch = await handlers['tool_result']({
      toolName: 'edit',
      input: { path: 'api-specification/openapi.yaml' },
      content: [{ type: 'text', text: 'файл записан' }],
    })
    const text = JSON.stringify(patch?.content ?? [])
    ok(text.includes('✗') && text.includes('[box-spec]'), 'pi-extension: tool_result дополняет результат ✗-списком', text.slice(0, 200))
    ok(text.includes('skills box-spec, component-tests'), 'pi-extension: список скиллов — динамически из манифеста', text.slice(0, 300))

    const clean = await handlers['tool_result']({ toolName: 'edit', input: { path: 'src/main.go' }, content: [] })
    ok(clean === undefined, 'pi-extension: посторонний путь — без патча')

    // git commit вне git-репозитория → check-tbd мягко пропускается
    const bash = await handlers['tool_result']({ toolName: 'bash', input: { command: 'git commit -m x' }, content: [] })
    ok(bash === undefined, 'pi-extension: git commit вне репо — без патча')
  } finally {
    process.chdir(prevCwd)
  }
}

// ---------- 2. Hook (Claude-формат) на эмуляции stdin ----------
{
  const payload = {
    cwd: FIX('bad'),
    tool_name: 'edit',
    tool_input: { file_path: 'api-specification/openapi.yaml' },
  }
  const r = run('node', [join(ROOT, 'hooks', 'standards-post-tool.mjs')], {
    input: JSON.stringify(payload),
  })
  ok(r.status === 0, 'hook: exit 0 (advisory)', r.stderr)
  let parsed = null
  try {
    parsed = JSON.parse(r.stdout)
  } catch {}
  ok(
    parsed?.hookSpecificOutput?.hookEventName === 'PostToolUse' &&
      typeof parsed.hookSpecificOutput.additionalContext === 'string',
    'hook: JSON c hookSpecificOutput.additionalContext',
    r.stdout
  )
  ok(
    (parsed?.hookSpecificOutput?.additionalContext || '').includes('✗'),
    'hook: additionalContext содержит ✗',
    r.stdout
  )
  ok(
    (parsed?.hookSpecificOutput?.additionalContext || '').includes('skills box-spec, component-tests, modules, tbd, release'),
    'hook: список скиллов в подсказке — динамически из манифеста',
    r.stdout
  )

  const unrelated = run('node', [join(ROOT, 'hooks', 'standards-post-tool.mjs')], {
    input: JSON.stringify({ cwd: FIX('bad'), tool_name: 'edit', tool_input: { file_path: 'src/main.go' } }),
  })
  ok(unrelated.status === 0 && unrelated.stdout.trim() === '', 'hook: посторонний файл → тишина', unrelated.stdout)

  const goodEdit = run('node', [join(ROOT, 'hooks', 'standards-post-tool.mjs')], {
    input: JSON.stringify({ cwd: FIX('good'), tool_name: 'edit', tool_input: { file_path: 'api-specification/openapi.yaml' } }),
  })
  ok(goodEdit.status === 0 && goodEdit.stdout.trim() === '', 'hook: good-фикстура → тишина', goodEdit.stdout)

  ok(
    (parsed?.hookSpecificOutput?.additionalContext || '').includes('[box-spec]'),
    'hook: нарушение помечено id стандарта [box-spec] (связь практика ↔ чекер)',
    r.stdout
  )

  const badJson = run('node', [join(ROOT, 'hooks', 'standards-post-tool.mjs')], { input: '{not json' })
  ok(badJson.status === 0 && badJson.stdout.trim() === '', 'hook: fail-open — битый JSON на stdin → exit 0, тишина', badJson.stdout)

  const emptyStdin = run('node', [join(ROOT, 'hooks', 'standards-post-tool.mjs')], { input: '' })
  ok(emptyStdin.status === 0 && emptyStdin.stdout.trim() === '', 'hook: fail-open — пустой stdin → exit 0, тишина', emptyStdin.stdout)

  const noInput = run('node', [join(ROOT, 'hooks', 'standards-post-tool.mjs')], { input: '{}' })
  ok(noInput.status === 0 && noInput.stdout.trim() === '', 'hook: payload без пути и команды → тишина', noInput.stdout)

  const outside = run('node', [join(ROOT, 'hooks', 'standards-post-tool.mjs')], {
    input: JSON.stringify({ cwd: FIX('bad'), tool_name: 'edit', tool_input: { file_path: '../../outside.txt' } }),
  })
  ok(outside.status === 0 && outside.stdout.trim() === '', 'hook: путь вне зон стандартов → тишина', outside.stdout)

  // Бюджет времени: не-матчинг пути ~0.12–0.19 с и матчинг (spawn чекеров) ~0.14 с
  // на эталонной машине; порог с запасом — ловит регрессию, не флейкает на CI.
  for (const [name, payload] of [
    ['вне зон', { cwd: FIX('good'), tool_name: 'edit', tool_input: { file_path: 'src/main.go' } }],
    ['в зоне', { cwd: FIX('good'), tool_name: 'edit', tool_input: { file_path: 'api-specification/openapi.yaml' } }],
  ]) {
    const t0 = process.hrtime.bigint()
    run('node', [join(ROOT, 'hooks', 'standards-post-tool.mjs')], { input: JSON.stringify(payload) })
    const ms = Number(process.hrtime.bigint() - t0) / 1e6
    ok(ms < 750, `hook: время (${name}) < 750 мс — фактическое ${ms.toFixed(0)} мс`)
  }
}

// ---------- 3. opencode-плагин напрямую ----------
{
  const mod = await import(pathToFileURL(join(ROOT, 'opencode-plugin', 'standards-guard.mjs')))
  ok(typeof mod.StandardsGuard === 'function', 'plugin: экспортирует StandardsGuard')

  const guard = await mod.StandardsGuard({ directory: FIX('bad') })
  ok(typeof guard['tool.execute.before'] === 'function', 'plugin: есть tool.execute.before')

  // посторонний путь — не мешает
  let threw = false
  try {
    await guard['tool.execute.before']({ tool: 'write', args: { filePath: 'src/main.go' } }, {})
  } catch {
    threw = true
  }
  ok(!threw, 'plugin: посторонний путь — без throw')

  // write с валидным контентом спеки — не мешает (проверка будущего состояния)
  threw = false
  try {
    await guard['tool.execute.before'](
      {
        tool: 'write',
        args: {
          filePath: 'api-specification/openapi.yaml',
          content: 'openapi: 3.1.0\nx-frozen: 2026-09-20\npaths:\n  /health:\n    get:\n      responses:\n        "200":\n          description: OK\n',
        },
      },
      {}
    )
  } catch (e) {
    threw = true
    console.log('      (неожиidанный throw: ' + e.message.slice(0, 200) + ')')
  }
  ok(!threw, 'plugin: write валидного контента — без throw')

  // write с НЕвалидным контентом — throw с ✗
  threw = false
  let msg = ''
  try {
    await guard['tool.execute.before'](
      { tool: 'write', args: { filePath: 'api-specification/openapi.yaml', content: 'openapi: 3.0.0\n' } },
      {}
    )
  } catch (e) {
    threw = true
    msg = e.message
  }
  ok(threw && msg.includes('✗'), 'plugin: write невалидного контента → throw с ✗', msg)

  // edit на плохой фикстуре — throw (проверка состояния диска)
  threw = false
  msg = ''
  try {
    await guard['tool.execute.before'](
      { tool: 'edit', args: { filePath: 'api-specification/openapi.yaml' } },
      {}
    )
  } catch (e) {
    threw = true
    msg = e.message
  }
  ok(threw && msg.includes('✗'), 'plugin: edit на нарушенном файле → throw с ✗', msg)
  ok(
    msg.includes('skills `box-spec`') && !msg.includes('`api-spec`'),
    'plugin: список скиллов из манифеста (дрейф api-spec закрыт)',
    msg.slice(-300)
  )
}

// ---------- 4. install.sh во временный каталог с подменным HOME ----------
{
  const tmp = mkdtempSync(join(tmpdir(), 'dev-standards-proj-'))
  const home = mkdtempSync(join(tmpdir(), 'dev-standards-home-'))
  try {
    // .git/hooks для pre-commit (без полного git init)
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(tmp, '.git', 'hooks'), { recursive: true })

    const env = { ...process.env, HOME: home }
    const args = [join(ROOT, 'install.sh'), tmp, '--targets=dsh,opencode,zcode,pi,claude', '--pre-commit']
    const r1 = run('bash', args, { env })
    ok(r1.status === 0, 'install: первый прогон exit 0', r1.stderr)
    if (r1.status !== 0) console.log(r1.stdout, r1.stderr)

    ok(lstatSync(join(tmp, '.agents', 'skills', 'box-spec')).isSymbolicLink(), 'install: .agents/skills/box-spec симлинк')
    ok(lstatSync(join(tmp, '.agents', 'skills', 'release')).isSymbolicLink(), 'install: .agents/skills/release симлинк (из манифеста)')
    ok(lstatSync(join(tmp, '.agents', 'skills', 'tbd')).isSymbolicLink(), 'install: .agents/skills/tbd симлинк (из манифеста)')
    ok(lstatSync(join(tmp, '.opencode', 'skills', 'component-tests')).isSymbolicLink(), 'install: .opencode/skills/component-tests симлинк')
    ok(lstatSync(join(tmp, '.opencode', 'skills', 'modules')).isSymbolicLink(), 'install: .opencode/skills/modules симлинк (из манифеста)')
    ok(lstatSync(join(tmp, '.opencode', 'plugins', 'standards-guard.mjs')).isSymbolicLink(), 'install: плагин opencode симлинк')

    const ocPath = existsSync(join(tmp, 'opencode.json')) ? join(tmp, 'opencode.json') : join(tmp, 'opencode.jsonc')
    const oc = JSON.parse(readFileSync(ocPath, 'utf8'))
    ok(
      Array.isArray(oc.plugin) && oc.plugin.includes('./.opencode/plugins/standards-guard.mjs'),
      'install: opencode-конфиг содержит plugin-запись'
    )

    const hj = JSON.parse(readFileSync(join(tmp, '.standards', 'hooks.json'), 'utf8'))
    ok(
      hj.hooks.PostToolUse?.[0]?.matcher === 'write|edit' &&
        hj.hooks.PostToolUse?.[0]?.hooks?.[0]?.command?.includes('standards-post-tool.mjs'),
      'install: hooks.json c matcher write|edit'
    )

    const cordis = readFileSync(join(home, '.dsh', 'cordis.patch.yml'), 'utf8')
    ok(cordis.includes('dev-standards-hooks') && cordis.includes("name: '@deepseek-ai/dsh-hooks-claude-code'"), 'install: cordis.patch.yml содержит мост dsh')

    const zc = JSON.parse(readFileSync(join(home, '.zcode', 'cli', 'config.json'), 'utf8'))
    ok(
      zc.hooks?.enabled === true &&
        zc.hooks?.events?.PostToolUse?.length === 1 &&
        zc.hooks.events.PostToolUse[0].hooks[0].command.includes('standards-post-tool.mjs'),
      'install: zcode config.json содержит PostToolUse-хук'
    )

    const piCfg = JSON.parse(readFileSync(join(home, '.pi', 'agent', 'settings.json'), 'utf8'))
    ok(
      Array.isArray(piCfg.packages) && piCfg.packages.includes(ROOT),
      'install: pi settings.json содержит extension-пакет'
    )

    ok(lstatSync(join(tmp, '.claude', 'skills', 'modules')).isSymbolicLink(), 'install: .claude/skills/modules симлинк')
    const cl = JSON.parse(readFileSync(join(tmp, '.claude', 'settings.json'), 'utf8'))
    ok(
      cl.hooks?.PostToolUse?.length === 1 &&
        cl.hooks.PostToolUse[0].matcher === 'Write|Edit' &&
        cl.hooks.PostToolUse[0].hooks[0].command.includes('standards-post-tool.mjs'),
      'install: claude settings.json содержит PostToolUse-хук'
    )
    ok(readFileSync(join(tmp, 'CLAUDE.md'), 'utf8').includes('@AGENTS.md'), 'install: CLAUDE.md shim = @AGENTS.md')

    const agents = readFileSync(join(tmp, 'AGENTS.md'), 'utf8')
    ok(count(agents, 'dev-standards:start') === 1, 'install: AGENTS.md managed-блок ровно один')
    ok(agents.includes('dev-standards:start v1') && agents.includes('dev-standards:end v1'), 'install: маркеры блока версионируются (v1)')
    ok(agents.includes('check-tbd') && agents.includes('Box-first'), 'install: доставлен актуальный эталон AGENTS.md')

    const gi = readFileSync(join(tmp, '.gitignore'), 'utf8')
    ok(gi.includes('/.agents/') && gi.includes('/.opencode/') && gi.includes('/.standards/'), 'install: .gitignore root-anchored записи')

    ok(
      existsSync(join(tmp, '.git', 'hooks', 'pre-commit')) &&
        (statSync(join(tmp, '.git', 'hooks', 'pre-commit')).mode & 0o111) !== 0,
      'install: pre-commit исполняемый'
    )
    ok(
      readFileSync(join(tmp, '.git', 'hooks', 'pre-commit'), 'utf8').includes('run-all.mjs') &&
        readFileSync(join(tmp, '.git', 'hooks', 'pre-commit'), 'utf8').includes('--report'),
      'install: pre-commit вызывает run-all в report-режиме'
    )
    ok(
      (() => {
        const pc = readFileSync(join(tmp, '.git', 'hooks', 'pre-commit'), 'utf8')
        return pc.includes('tools/generate.mjs') && pc.includes('--check')
      })(),
      'install: pre-commit проверяет свежесть артефактов standards-репозитория'
    )

    // Идемпотентность: второй прогон не создаёт дублей
    const r2 = run('bash', args, { env })
    ok(r2.status === 0, 'install: повторный прогон exit 0', r2.stderr)
    const cordis2 = readFileSync(join(home, '.dsh', 'cordis.patch.yml'), 'utf8')
    ok(count(cordis2, 'dev-standards-hooks') === 1, 'install: идемпотентность — мост dsh один')
    const zc2 = JSON.parse(readFileSync(join(home, '.zcode', 'cli', 'config.json'), 'utf8'))
    ok(zc2.hooks.events.PostToolUse.length === 1, 'install: идемпотентность — zcode-хук один')
    const piCfg2 = JSON.parse(readFileSync(join(home, '.pi', 'agent', 'settings.json'), 'utf8'))
    ok(piCfg2.packages.filter((p) => p === ROOT).length === 1, 'install: идемпотентность — pi-пакет один')
    const cl2 = JSON.parse(readFileSync(join(tmp, '.claude', 'settings.json'), 'utf8'))
    ok(cl2.hooks.PostToolUse.length === 1, 'install: идемпотентность — claude-хук один')
    const agents2 = readFileSync(join(tmp, 'AGENTS.md'), 'utf8')
    ok(count(agents2, 'dev-standards:start') === 1, 'install: идемпотентность — managed-блок один')
    ok(agents2.includes('check-tbd'), 'install: идемпотентность — эталон в блоке сохранён')

    // миграция: проект, установленный до v0.5 (маркеры без версии), обновляется на v1
    writeFileSync(
      join(tmp, 'AGENTS.md'),
      agents2.replaceAll('dev-standards:start v1', 'dev-standards:start').replaceAll('dev-standards:end v1', 'dev-standards:end')
    )
    const r3 = run('bash', args, { env })
    ok(r3.status === 0, 'install: прогон поверх legacy-маркеров exit 0', r3.stderr)
    const agents3 = readFileSync(join(tmp, 'AGENTS.md'), 'utf8')
    ok(
      agents3.includes('dev-standards:start v1') && count(agents3, 'dev-standards:start') === 1 && agents3.includes('Box-first'),
      'install: старый блок заменён на v1, содержимое обновлено, дублей нет'
    )
    const oc2 = JSON.parse(readFileSync(ocPath, 'utf8'))
    ok(oc2.plugin.filter((p) => p.includes('standards-guard')).length === 1, 'install: идемпотентность — plugin-запись одна')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)

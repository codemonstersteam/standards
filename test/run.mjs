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

  const unrelated = run('node', [join(ROOT, 'hooks', 'standards-post-tool.mjs')], {
    input: JSON.stringify({ cwd: FIX('bad'), tool_name: 'edit', tool_input: { file_path: 'src/main.go' } }),
  })
  ok(unrelated.status === 0 && unrelated.stdout.trim() === '', 'hook: посторонний файл → тишина', unrelated.stdout)

  const goodEdit = run('node', [join(ROOT, 'hooks', 'standards-post-tool.mjs')], {
    input: JSON.stringify({ cwd: FIX('good'), tool_name: 'edit', tool_input: { file_path: 'api-specification/openapi.yaml' } }),
  })
  ok(goodEdit.status === 0 && goodEdit.stdout.trim() === '', 'hook: good-фикстура → тишина', goodEdit.stdout)
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
    const oc2 = JSON.parse(readFileSync(ocPath, 'utf8'))
    ok(oc2.plugin.filter((p) => p.includes('standards-guard')).length === 1, 'install: идемпотентность — plugin-запись одна')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)

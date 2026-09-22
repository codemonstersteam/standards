#!/usr/bin/env node
// Прогон всех проверок MVP: чекеры на фикстурах, hook на эмуляции stdin,
// opencode-плагин напрямую, install.sh во временный каталог с подменным HOME.
// Запуск: node test/run.mjs   (exit 0 = всё зелёное)
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
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
    const args = [join(ROOT, 'install.sh'), tmp, '--zcode', '--pre-commit']
    const r1 = run('bash', args, { env })
    ok(r1.status === 0, 'install: первый прогон exit 0', r1.stderr)
    if (r1.status !== 0) console.log(r1.stdout, r1.stderr)

    ok(lstatSync(join(tmp, '.agents', 'skills', 'api-spec')).isSymbolicLink(), 'install: .agents/skills/api-spec симлинк')
    ok(lstatSync(join(tmp, '.opencode', 'skills', 'component-tests')).isSymbolicLink(), 'install: .opencode/skills/component-tests симлинк')
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

    const agents = readFileSync(join(tmp, 'AGENTS.md'), 'utf8')
    ok(count(agents, 'dev-standards:start') === 1, 'install: AGENTS.md managed-блок ровно один')
    ok(agents.includes('rationaldev-ai-sdlc-skills'), 'install: доставлен эталон AGENTS.md (rationaldev)')

    const gi = readFileSync(join(tmp, '.gitignore'), 'utf8')
    ok(gi.includes('/.agents/') && gi.includes('/.opencode/') && gi.includes('/.standards/'), 'install: .gitignore root-anchored записи')

    ok(
      existsSync(join(tmp, '.git', 'hooks', 'pre-commit')) &&
        (statSync(join(tmp, '.git', 'hooks', 'pre-commit')).mode & 0o111) !== 0,
      'install: pre-commit исполняемый'
    )

    // Идемпотентность: второй прогон не создаёт дублей
    const r2 = run('bash', args, { env })
    ok(r2.status === 0, 'install: повторный прогон exit 0', r2.stderr)
    const cordis2 = readFileSync(join(home, '.dsh', 'cordis.patch.yml'), 'utf8')
    ok(count(cordis2, 'dev-standards-hooks') === 1, 'install: идемпотентность — мост dsh один')
    const zc2 = JSON.parse(readFileSync(join(home, '.zcode', 'cli', 'config.json'), 'utf8'))
    ok(zc2.hooks.events.PostToolUse.length === 1, 'install: идемпотентность — zcode-хук один')
    const agents2 = readFileSync(join(tmp, 'AGENTS.md'), 'utf8')
    ok(count(agents2, 'dev-standards:start') === 1, 'install: идемпотентность — managed-блок один')
    ok(agents2.includes('rationaldev-ai-sdlc-skills'), 'install: идемпотентность — эталон в блоке сохранён')
    const oc2 = JSON.parse(readFileSync(ocPath, 'utf8'))
    ok(oc2.plugin.filter((p) => p.includes('standards-guard')).length === 1, 'install: идемпотентность — plugin-запись одна')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)

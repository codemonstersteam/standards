#!/usr/bin/env node
// Генератор артефактов из rules/ (единственный источник правды):
//   skills/<id>/SKILL.md   — скиллы для всех 5 харнессов (SKILL.md — открытый
//                            стандарт agentskills.io, per-target варианты не нужны)
//   standards.json         — манифест для рантаймов (zero-dep JSON.parse)
//   AGENTS.md              — managed-блок списка скиллов в футере
//   package.json           — version из rules/meta.yaml
// Режимы: node tools/generate.mjs [--check|--list|--clean]
//   (без флага) — перегенерация изменившихся файлов
//   --check — свежесть для CI: не писать, сравнить с диском; дрейф = exit 1
//   --list  — сухой прогон: план артефактов (fresh / would update), без записи
//   --clean — удалить артефакты-владельцы (SKILL.md, standards.json) и вырезать
//             skills-блок из AGENTS.md; package.json не трогаем (правится только
//             строка version, прежнее значение не храним). Восстановление — generate.
//
// Подход к генерации одолжен у Grafana Hatch (github.com/grafana/hatch, Apache-2.0):
// источник и сгенерённое коммитятся вместе, freshness-проверка для CI,
// версионированные маркеры блоков, режимы list/clean. Реализация своя (zero-dep
// Node + композиция из YAML-правил — чего Hatch не делает); формат скиллов —
// открытый стандарт Agent Skills (agentskills.io).
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseYaml } from '../lib/yaml.mjs'

const ROOT = dirname(dirname(realpathSync(fileURLToPath(import.meta.url))))
const RULES = join(ROOT, 'rules')
const MODES = ['--check', '--list', '--clean'].filter((f) => process.argv.includes(f))
if (MODES.length > 1) {
  console.error(`generate: ✗ режимы взаимоисключающие: ${MODES.join(' ')}`)
  process.exit(1)
}
const MODE = MODES[0] ?? 'gen'

const fail = (msg) => {
  console.error(`generate: ✗ ${msg}`)
  process.exit(1)
}

// ---------- загрузка источника ----------
const meta = parseYaml(readFileSync(join(RULES, 'meta.yaml'), 'utf8'))
if (!meta.version || !Array.isArray(meta.order) || !meta.manifest_comment) {
  fail('rules/meta.yaml: нужны version, order[], manifest_comment')
}

const onDisk = readdirSync(RULES, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
const orphan = onDisk.filter((id) => !meta.order.includes(id))
if (orphan.length) fail(`rules/${orphan[0]}/ нет в order файла meta.yaml`)

const rules = meta.order.map((id) => {
  const dir = join(RULES, id)
  const file = join(dir, 'rule.yaml')
  if (!existsSync(file)) fail(`нет ${file}`)
  const r = parseYaml(readFileSync(file, 'utf8'))
  for (const field of ['id', 'name', 'title', 'description', 'summary', 'enforcement', 'sections']) {
    if (r[field] === undefined) fail(`rules/${id}/rule.yaml: нет поля ${field}`)
  }
  if (r.id !== id) fail(`rules/${id}/rule.yaml: id «${r.id}» не совпадает с каталогом`)
  r._dir = dir
  return r
})

// Мета чекеров («что проверяет») — у самих чекеров: node checks/<x>.mjs --meta.
const checkMetas = {}
for (const r of rules) {
  for (const c of r.checks ?? []) {
    if (checkMetas[c.check]) continue
    if (!existsSync(join(ROOT, 'checks', `${c.check}.mjs`))) fail(`чекер не найден: ${c.check}`)
    const p = spawnSync(process.execPath, [join(ROOT, 'checks', `${c.check}.mjs`), '--meta'], {
      encoding: 'utf8',
    })
    if (p.status !== 0) fail(`чекер ${c.check} не отдал --meta: ${String(p.stderr || '').trim()}`)
    try {
      checkMetas[c.check] = JSON.parse(p.stdout)
    } catch {
      fail(`чекер ${c.check}: --meta вернул не-JSON`)
    }
  }
}

// ---------- рендер SKILL.md ----------
function numbered(item, i) {
  const lines = String(item).split('\n')
  return [`${i + 1}. ${lines[0]}`, ...lines.slice(1).map((l) => `   ${l}`)].join('\n')
}

function bullet(item) {
  const lines = String(item).split('\n')
  return [`- ${lines[0]}`, ...lines.slice(1).map((l) => `  ${l}`)].join('\n')
}

function renderChecks(rule) {
  const cs = rule.checks_section ?? {}
  if (!cs.heading) fail(`rules/${rule.id}: checks_section.heading обязателен`)
  const checks = rule.checks ?? []
  if (checks.length === 0) {
    if (!cs.no_checks_text) fail(`rules/${rule.id}: нет checks и нет checks_section.no_checks_text`)
    return [cs.heading, cs.no_checks_text.replace(/\n+$/, '')].join('\n\n')
  }
  const parts = []
  const notes = []
  for (const c of checks) {
    const m = checkMetas[c.check]
    if (Array.isArray(m.what)) parts.push(m.what.map((w) => `- ${w}`).join('\n'))
    else parts.push(m.what)
    if (m.notes) notes.push(m.notes)
  }
  const joiner = cs.join === 'newline' ? '\n' : ' '
  let body = parts.join(joiner)
  for (const n of notes) body += `\n\n${n}`
  return [cs.heading, body].join('\n\n')
}

function renderSection(entry, rule) {
  if (entry === 'legacy') return `## Существующий проект\n\n${String(rule.legacy ?? '').replace(/\n+$/, '')}`
  if (entry === 'checks') return renderChecks(rule)
  if (entry === 'stop') {
    if (!rule.stop || rule.stop.length === 0) fail(`rules/${rule.id}: секция stop без items`)
    return `## STOP\n\n${rule.stop.map(bullet).join('\n')}`
  }
  if (entry.startsWith('rules:')) {
    const g = (rule.rule_groups ?? {})[entry.slice('rules:'.length)]
    if (!g || !Array.isArray(g.items)) fail(`rules/${rule.id}: нет группы «${entry}»`)
    return [g.heading, g.items.map(numbered).join('\n')].join('\n\n')
  }
  const prosePath = join(rule._dir, 'prose', entry)
  if (!existsSync(prosePath)) fail(`rules/${rule.id}/prose/${entry} не найден`)
  return readFileSync(prosePath, 'utf8').replace(/\n+$/, '')
}

function sourceHash(rule) {
  // provenance: хэш исходников, из которых собран скилл
  const parts = [readFileSync(join(rule._dir, 'rule.yaml'), 'utf8')]
  for (const s of rule.sections) {
    if (!s.startsWith('rules:') && !['legacy', 'checks', 'stop'].includes(s)) {
      parts.push(readFileSync(join(rule._dir, 'prose', s), 'utf8'))
    }
  }
  return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 8)
}

function renderSkill(rule) {
  const description = String(rule.description).replace(/\n+/g, ' ').trim()
  const parts = [`---\nname: ${rule.name}\ndescription: ${description}\n---`, `# Стандарт: ${rule.title}`]
  for (const s of rule.sections) parts.push(renderSection(s, rule))
  const hash = sourceHash(rule)
  const stamp = `<!-- dev-standards:generated from rules/${rule.id} sha256:${hash} dev-standards@v${meta.version} — не редактировать: измени источник и запусти node tools/generate.mjs -->`
  return `${parts.join('\n\n')}\n${stamp}\n`
}

// ---------- рендер standards.json (формат стабильный: массивы скаляров инлайн) ----------
const q = (v) => JSON.stringify(String(v))

function emitManifest() {
  const L = []
  L.push('{')
  L.push(`  "$comment": ${JSON.stringify(meta.manifest_comment.replace(/\n+$/, ''))},`)
  L.push(`  "version": ${q(meta.version)},`)
  L.push('  "standards": [')
  rules.forEach((r, ri) => {
    L.push('    {')
    L.push(`      "id": ${q(r.id)},`)
    L.push(`      "enforcement": ${q(r.enforcement)},`)
    L.push(`      "guidance": ${q(`skills/${r.id}/SKILL.md`)},`)
    L.push(`      "summary": ${q(r.summary)},`)
    const checks = r.checks ?? []
    if (checks.length === 0) {
      L.push('      "checks": []')
    } else {
      L.push('      "checks": [')
      checks.forEach((c, ci) => {
        L.push('        {')
        const entries = Object.entries(c)
        entries.forEach(([k, v], ei) => {
          const val = Array.isArray(v) ? `[${v.map(q).join(', ')}]` : q(v)
          const comma = ei < entries.length - 1 ? ',' : ''
          L.push(`          ${JSON.stringify(k)}: ${val}${comma}`)
        })
        L.push(`        }${ci < checks.length - 1 ? ',' : ''}`)
      })
      L.push('      ]')
    }
    L.push(`    }${ri < rules.length - 1 ? ',' : ''}`)
  })
  L.push('  ]')
  L.push('}')
  return L.join('\n') + '\n'
}

// ---------- AGENTS.md: managed-блок списка скиллов в футере ----------
// Маркеры версионируются (по образцу hatch:begin v1): смена версии формата блока
// не ломает установленное — генератор распознаёт любую версию и нормализует на актуальную.
const SKILLS_START = '<!-- dev-standards:skills:start v1 -->'
const SKILLS_END = '<!-- dev-standards:skills:end v1 -->'
const SKILLS_BLOCK_RE = /<!-- dev-standards:skills:start(?: v\d+)? -->[\s\S]*?<!-- dev-standards:skills:end(?: v\d+)? -->/

function emitAgents() {
  const text = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8')
  const list = rules.map((r) => `\`${r.id}\``).join(', ')
  const block = `Подробности: skills ${list}\n(поставляются вместе со стандартом).`
  if (SKILLS_BLOCK_RE.test(text)) {
    return text.replace(SKILLS_BLOCK_RE, `${SKILLS_START}\n${block}\n${SKILLS_END}`)
  }
  // маркеров нет (первая генерация или после --clean) — блок добавляется в конец
  return `${text.replace(/\s+$/, '')}\n\n${SKILLS_START}\n${block}\n${SKILLS_END}\n`
}

// ---------- сборка и режимы: gen / --check / --list / --clean ----------
// owned = артефакт-владелец (удаляется --clean); патчи (блок AGENTS.md, version) — нет.
const outputs = []
for (const r of rules) outputs.push({ path: join(ROOT, 'skills', r.id, 'SKILL.md'), content: renderSkill(r), owned: true })
outputs.push({ path: join(ROOT, 'standards.json'), content: emitManifest(), owned: true })
outputs.push({ path: join(ROOT, 'AGENTS.md'), content: emitAgents(), owned: false })

const pkgPath = join(ROOT, 'package.json')
const pkgRaw = readFileSync(pkgPath, 'utf8')
if (!/"version"\s*:/.test(pkgRaw)) fail('package.json: нет поля version')
// правим только строку version, сохраняя форматирование остального файла
const pkgPatched = pkgRaw.replace(/^(\s*"version"\s*:\s*")[^"]*(")/m, `$1${meta.version}$2`)
outputs.push({ path: pkgPath, content: pkgPatched, owned: false })

const rel = (p) => p.replace(ROOT + '/', '')
const isFresh = (o) => existsSync(o.path) && readFileSync(o.path, 'utf8') === o.content

if (MODE === '--check') {
  const stale = outputs.filter((o) => !isFresh(o))
  if (stale.length) {
    console.error(`generate: ✗ артефакты не свежи (измени источник и запусти node tools/generate.mjs):`)
    for (const o of stale) console.error(`  ✗ ${rel(o.path)}`)
    process.exit(1)
  }
  console.log(`generate: OK — все ${outputs.length} артефактов свежи (источник rules/ v${meta.version})`)
  process.exit(0)
}

if (MODE === '--list') {
  for (const o of outputs) {
    console.log(`${isFresh(o) ? '=' : '*'} ${rel(o.path)} (${isFresh(o) ? 'fresh' : 'would update'})`)
  }
  process.exit(0)
}

if (MODE === '--clean') {
  for (const o of outputs.filter((o) => o.owned)) {
    if (!existsSync(o.path)) continue
    rmSync(o.path)
    for (const d of [dirname(o.path), dirname(dirname(o.path))]) {
      try {
        rmSync(d) // пустые каталоги (skills/<id>, skills/) убираем тоже
      } catch {
        // не пуст — оставляем
      }
    }
    console.log(`generate: удалён ${rel(o.path)}`)
  }
  const agentsPath = join(ROOT, 'AGENTS.md')
  const agents = readFileSync(agentsPath, 'utf8')
  if (SKILLS_BLOCK_RE.test(agents)) {
    writeFileSync(agentsPath, agents.replace(SKILLS_BLOCK_RE, '').replace(/\s+$/, '') + '\n')
    console.log(`generate: вырезан skills-блок из ${rel(agentsPath)}`)
  }
  console.log('generate: clean завершён (восстановление — node tools/generate.mjs)')
  process.exit(0)
}

let changed = 0
for (const o of outputs) {
  if (isFresh(o)) continue
  writeFileSync(o.path, o.content)
  changed++
  console.log(`generate: ${rel(o.path)}`)
}
if (!changed) console.log(`generate: OK — артефакты уже свежи (${outputs.length} файлов)`)

#!/usr/bin/env node
// Инвариант valid-by-construction для Go: доменный тип строится фабрикой,
// фабрика проверяет вход, «голые» литералы доменного типа вне фабрики запрещены.
// Прогрессивность: проверяются ТОЛЬКО изменённые *.go (или переданные --files);
// не git-репозиторий / нет Go-файлов / нечего проверять → мягкий пропуск.
// Контракт: exit 0 = OK/пропуск; exit 1 = список `✗` в stderr (severity warn —
// решение о строгости принимает run-all/манифест).
// Запуск: node checks/check-constructors.mjs <projectRoot> [--files a.go b.go]
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { walkFiles } from '../lib/common.mjs'

// Что проверяет чекер — источник для генератора скиллов (tools/generate.mjs).
export const meta = {
  what:
    '`check-constructors` (Go) — в изменённых `*.go`: доменные типы с фабрикой\nбез ветки ошибки, голые литералы доменных типов вне фабрики (warn).',
}
if (process.argv.includes('--meta')) {
  console.log(JSON.stringify(meta))
  process.exit(0)
}

const argv = process.argv.slice(2)
const root = resolve(argv.find((a) => !a.startsWith('--')) || process.cwd())
const filesIdx = argv.indexOf('--files')
const explicit = filesIdx !== -1 ? argv.slice(filesIdx + 1).filter((a) => !a.startsWith('--')) : null

const isRepo = spawnSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' })
const inRepo = isRepo.status === 0 && String(isRepo.stdout).trim() === 'true'

let files = []
if (explicit) {
  files = explicit.map((f) => (isAbsolute(f) ? f : resolve(root, f)))
} else if (inRepo) {
  const git = (args) => String(spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' }).stdout || '')
  const changed = new Set()
  // изменённые относительно HEAD + незатрекнутые новые
  for (const out of [git(['diff', '--name-only', 'HEAD']), git(['ls-files', '-o', '--exclude-standard'])]) {
    for (const f of out.split('\n')) if (f.trim()) changed.add(f.trim())
  }
  files = [...changed].filter((f) => f.endsWith('.go')).map((f) => join(root, f))
} else {
  files = []
}
// только существующие файлы; в тестах фикс-файлы могут лежать вне git
files = files.filter((f) => { try { readFileSync(f); return true } catch { return false } })

// Инфра- и DTO-имена не считаем доменными типами (как в rationaldev).
const EXEMPT = /(Request|Response|DTO|Config|Options|Params)$|^(Raw)|(_test)\.go$|(Store|Client|Handler|Server|Repo|Repository|Controller|Service|Adapter|Publisher|Consumer|Loader|Writer|Reader)$/

const errors = []
if (files.length === 0) {
  console.log('check-constructors: OK — изменённых Go-файлов нет, проверка пропущена')
  process.exit(0)
}

// 1) собираем фабрики NewX -> (X, ...) по всем переданным файлам
const factories = new Map() // typeName -> { file, start, end, hasErrorBranch, ok }
for (const f of files) {
  const text = readFileSync(f, 'utf8')
  const re = /func\s+(New[A-Z]\w*)\s*\(([^)]*)\)\s*\(([^)]*)\)\s*\{|func\s+(New[A-Z]\w*)\s*\(([^)]*)\)\s*([A-Z]\w*)\s*\{/g
  let m
  while ((m = re.exec(text))) {
    const isTuple = Boolean(m[1])
    const name = m[1] || m[4]
    const rets = isTuple ? m[3] : m[6]
    const typeName = name.slice(3)
    if (EXEMPT.test(typeName)) continue
    const hasError = /\berror\b/.test(rets)
    // тело функции: m[0] кончается на открывающей `{`; ищем парную закрывающую
    const bodyStart = m.index + m[0].length
    let depth = 1, i = bodyStart
    while (depth > 0 && i < text.length) { if (text[i] === '{') depth++; else if (text[i] === '}') depth--; i++ }
    const body = text.slice(bodyStart, i)
    // фабрика обязана проверять: существует return с НЕ-nil вторым значением (ветка ошибки)
    const errorBranch = hasError && /return\s+[^;]*?,\s*(?!nil\b)(?:err|errors\.\w+\(|fmt\.Errorf)/.test(body)
    factories.set(typeName, { file: relative(root, f), start: bodyStart, end: i, ok: errorBranch })
  }
}

// 2) фабрики без ветки ошибки — нарушение
for (const [t, f] of factories) {
  if (!f.ok) errors.push(`фабрика New${t} (${f.file}) не проверяет вход — нет ветки возврата ошибки; вход валидируй по доменным диапазонам`)
}

// 3) «голые» литералы доменного типа вне его фабрики
for (const f of files) {
  if (f.endsWith('_test.go')) continue
  const text = readFileSync(f, 'utf8')
  const rel = relative(root, f)
  for (const [t, fac] of factories) {
    if (EXEMPT.test(t)) continue
    // литералы с заполненными полями: T{Field: ...} или T{"positional"
    const lit = new RegExp(`(?:^|[^\\w.])${t}\\{(?![\\s}])`, 'g')
    let m
    while ((m = lit.exec(text))) {
      const inOwnFactory = fac.file === rel && m.index >= fac.start && m.index <= fac.end
      if (!inOwnFactory) {
        errors.push(`${rel}: «голый» литерал ${t}{...} вне фабрики New${t} — строй через фабрику, иначе инвариант не гарантирован`)
        break // один файл — одно сообщение на тип
      }
    }
  }
}

if (errors.length) {
  console.error('check-constructors: нарушение valid-by-construction (warn):')
  for (const e of errors) console.error(`  ✗ ${e}`)
  process.exit(1)
}
console.log(`check-constructors: OK — ${files.length} изменённых Go-файлов, доменные типы строятся фабриками`)

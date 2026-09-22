#!/usr/bin/env node
// Требование «компонентные тесты — исполняемая спецификация».
// Запуск: node checks/check-component-tests.mjs <projectRoot>
// Контракт: exit 0 = OK (строка в stdout); exit 1 = список `✗` в stderr.
import { existsSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parseFeature, walkFiles } from '../lib/common.mjs'

const root = resolve(process.argv[2] || process.cwd())
const ctDir = join(root, 'component-tests')
const errors = []

let business = []
let smoke = 0
const titles = new Map()

// Поддерживаем обе раскладки: component-tests/features/*.feature (один сервис)
// и component-tests/<svc>/features/*.feature (мультисервисный проект) — ищем
// .feature рекурсивно по всему component-tests/.
if (!existsSync(ctDir)) {
  errors.push('`component-tests/` не найден — компонентные тесты отсутствуют')
} else {
  const files = walkFiles(ctDir, '.feature')
  if (files.length === 0) {
    errors.push('в `component-tests/` нет ни одного *.feature')
  }
  for (const f of files) {
    const { scenarios } = parseFeature(readFileSync(f, 'utf8'))
    for (const s of scenarios) {
      const where = relative(root, f)
      if (s.tags.includes('smoke')) {
        smoke++
      } else {
        business.push(s)
        if (!s.tags.includes('wip')) {
          errors.push(`сценарий «${s.name}» (${where}) без @wip — все бизнес-сценарии держатся @wip до фиксации`)
        }
      }
      titles.set(s.name, (titles.get(s.name) || 0) + 1)
    }
  }
  for (const [name, n] of titles) {
    if (n > 1) errors.push(`название сценария «${name}» встречается ${n} раза — дубли запрещены`)
  }
  if (smoke === 0 && files.length > 0) {
    errors.push('нет @smoke-сценария — дымовой сценарий обязателен')
  }
}

// Формула из дизайна: N = a + b в docs/design/**/contracts.md (мягкий пропуск,
// если дизайн формулу не объявляет).
let declared = null
const contracts = walkFiles(join(root, 'docs', 'design'), '.md').filter((f) => f.endsWith('contracts.md'))
for (const f of contracts) {
  const text = readFileSync(f, 'utf8')
  for (const m of text.matchAll(/N\s*=\s*(\d+)\s*\+\s*(\d+)/g)) {
    declared = (declared ?? 0) + Number(m[1]) + Number(m[2])
  }
}
if (declared !== null && business.length !== declared) {
  errors.push(`сценариев ${business.length} ≠ дизайн N=${declared} (формула 1+Σ) — пропущен или выдуман сценарий`)
}

if (errors.length) {
  console.error('check-component-tests: покрытие неполно (кол-во / @wip / smoke):')
  for (const e of errors) console.error(`  ✗ ${e}`)
  console.error('  → реализуй РОВНО спроектированные сценарии (1+Σ), все @wip, smoke обязателен.')
  process.exit(1)
}
const nInfo = declared !== null ? `, N=${declared}` : ' (N не объявлена — сверка пропущена)'
console.log(`check-component-tests: OK — ${business.length} бизнес-сценариев @wip, smoke=${smoke}${nInfo}`)

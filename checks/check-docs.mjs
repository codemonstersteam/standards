#!/usr/bin/env node
// Детерминированное ядро Doc as Code: при существующем контракте README коробки
// обязан содержать pipe-описание (fenced-блок) и секцию таблицы отказов.
// Прогрессивность: нет контракта → мягкий пропуск; нарушения → warn.
// Контракт: exit 0 = OK/пропуск; exit 1 = список `✗` в stderr.
// Запуск: node checks/check-docs.mjs <projectRoot>
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.argv[2] || process.cwd())
const contract = [join(root, 'api-specification', 'openapi.yaml'), join(root, 'api-specification', 'openapi.yml')]
  .find((p) => existsSync(p))

if (!contract) {
  console.log('check-docs: OK — контракта нет, Doc as Code проверка пропущена')
  process.exit(0)
}

const errors = []
const readme = join(root, 'README.md')
if (!existsSync(readme)) {
  errors.push('README.md не найден — Doc as Code: документация коробки живёт в репо (spec → docs → code)')
} else {
  const text = readFileSync(readme, 'utf8')
  const fences = (text.match(/^```/gm) || []).length
  if (fences < 2) {
    errors.push('в README нет fenced-блока с pipe-описанием (как данные текут по шагам и где ломается)')
  }
  if (!/(таблица отказов|карта режимов отказа|failures?|ошибки)/i.test(text)) {
    errors.push('в README нет секции таблицы отказов (каждый error.code из контракта должен быть виден потребителю)')
  }
}

if (errors.length) {
  console.error('check-docs: Doc as Code неполон (warn):')
  for (const e of errors) console.error(`  ✗ ${e}`)
  process.exit(1)
}
console.log('check-docs: OK — README содержит pipe-описание и таблицу отказов')

#!/usr/bin/env node
// Требование «API-спека первична и заморожена».
// Запуск: node checks/check-api-spec.mjs <projectRoot> [--spec <файл>]
//   --spec — проверить конкретный файл вместо api-specification/openapi.yaml
//            (используется opencode-плагином для валидации будущего состояния).
// Контракт: exit 0 = OK (строка в stdout); exit 1 = список `✗` в stderr.
import { existsSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const argv = process.argv.slice(2)
const root = resolve(argv.find((a) => !a.startsWith('--')) || process.cwd())
const specIdx = argv.indexOf('--spec')
const override = specIdx !== -1 ? resolve(argv[specIdx + 1]) : null

const candidates = override
  ? [override]
  : [join(root, 'api-specification', 'openapi.yaml'), join(root, 'api-specification', 'openapi.yml')]
const spec = candidates.find((p) => existsSync(p))

const errors = []
let shown = 'api-specification/openapi.yaml'

if (!spec) {
  errors.push('api-specification/openapi.yaml не найден — контракт отсутствует')
} else {
  shown = override ? spec : relative(root, spec)
  const text = readFileSync(spec, 'utf8')
  const lines = text.split(/\r?\n/)

  if (!lines.some((l) => /^openapi:\s*['"]?3/.test(l))) {
    errors.push('нет `openapi: 3.x` — версия не указана или не 3.x')
  }

  const pathsIdx = lines.findIndex((l) => /^paths:\s*$/.test(l))
  if (pathsIdx === -1) {
    errors.push('нет секции `paths:`')
  } else {
    let pathCount = 0
    for (let i = pathsIdx + 1; i < lines.length; i++) {
      const l = lines[i]
      if (/^\S/.test(l)) break // следующий top-level ключ — конец секции
      if (/^\s+\/[^\s#:]+:/.test(l)) pathCount++
    }
    if (pathCount === 0) errors.push('в `paths:` нет ни одного пути (например `  /health:`)')
  }

  if (!lines.some((l) => /^\s*responses:\s*$/.test(l))) {
    errors.push('нет секций `responses:` — коды ответов не описаны')
  }

  const frozen = text.match(/^x-frozen:\s*(.+)$/m)
  if (!frozen) {
    errors.push('нет маркера заморозки `x-frozen:` — контракт не заморожен')
  } else if (/^(false|no|нет)$/i.test(frozen[1].trim())) {
    errors.push('`x-frozen: false` — контракт не заморожен')
  }
}

if (errors.length) {
  console.error(`check-api-spec: контракт НЕ соответствует стандарту (${shown}):`)
  for (const e of errors) console.error(`  ✗ ${e}`)
  process.exit(1)
}
console.log(`check-api-spec: OK — контракт полон и заморожен (${shown})`)

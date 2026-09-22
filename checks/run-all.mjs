#!/usr/bin/env node
// Единая точка входа для ВСЕХ проверок манифеста (pre-commit / ручной запуск).
// Запуск: node checks/run-all.mjs <projectRoot>
// Контракт: exit 0 = OK (сводка в stdout); exit 1 = все `✗` в stderr.
import { resolve } from 'node:path'
import { loadManifest, runCheck } from '../lib/common.mjs'

const root = resolve(process.argv[2] || process.cwd())
const manifest = loadManifest()

const failed = []
let total = 0
for (const std of manifest.standards) {
  for (const check of std.checks ?? []) {
    total++
    const { errors } = runCheck(check.check, root)
    for (const e of errors) failed.push(`[${std.id}] ${e.replace(/^✗\s*/, '')}`)
  }
}

if (failed.length) {
  console.error(`run-all: ${failed.length} нарушений (${total} проверок):`)
  for (const e of failed) console.error(`  ✗ ${e}`)
  process.exit(1)
}
console.log(`run-all: OK — ${total} проверок по манифесту пройдено`)

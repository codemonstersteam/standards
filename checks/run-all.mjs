#!/usr/bin/env node
// Единая точка входа для ВСЕХ проверок манифеста.
// Запуск: node checks/run-all.mjs <projectRoot> [--report|--strict]
//   --strict (по умолчанию): exit 1, если есть нарушения уровня error;
//     warn печатается, но не роняет (прогрессивность: существующие проекты).
//   --report: всегда exit 0, печатает ✗-сводку — режим pre-commit по умолчанию.
// Уважает severity из манифеста и langs (языковые проверки — только при наличии файлов языка).
// Маркер `✗ [error]` в выводе чекера усиливает нарушение до error независимо от манифеста.
import { resolve } from 'node:path'
import { loadManifest, runCheck, walkFiles } from '../lib/common.mjs'

const argv = process.argv.slice(2)
const root = resolve(argv.find((a) => !a.startsWith('--')) || process.cwd())
const mode = argv.includes('--report') ? 'report' : 'strict'

const manifest = loadManifest()
const errorViolations = []
const warnViolations = []
let total = 0

for (const std of manifest.standards) {
  for (const check of std.checks ?? []) {
    // языковое ограничение: langs: ["go"] → запускать только если в проекте есть файлы языка
    if (check.langs && check.langs.includes('go')) {
      if (walkFiles(root, '.go').length === 0) continue
    }
    total++
    const { errors } = runCheck(check.check, root)
    for (const line of errors) {
      const marker = line.match(/^✗ \[(error|warn)\]/)
      const isHard = check.severity === 'error' || marker?.[1] === 'error'
      const clean = line.replace(/^✗ (?:\[(?:error|warn)\] )?/, '')
      ;(isHard ? errorViolations : warnViolations).push(`[${std.id}] ${clean}`)
    }
  }
}

if (mode === 'report') {
  if (errorViolations.length || warnViolations.length) {
    console.error(`run-all (отчёт): error=${errorViolations.length}, warn=${warnViolations.length} (${total} проверок):`)
    for (const e of errorViolations) console.error(`  ✗ [error] ${e}`)
    for (const e of warnViolations) console.error(`  ✗ ${e}`)
  } else {
    console.log(`run-all: OK — ${total} проверок по манифесту пройдено`)
  }
  process.exit(0)
}

if (errorViolations.length) {
  console.error(`run-all: ${errorViolations.length} нарушений уровня error (warn: ${warnViolations.length}) из ${total} проверок:`)
  for (const e of errorViolations) console.error(`  ✗ ${e}`)
  for (const e of warnViolations) console.error(`  ◦ [warn] ${e}`)
  process.exit(1)
}
console.log(`run-all: OK — ${total} проверок, error=0 (warn: ${warnViolations.length})`)
for (const e of warnViolations) console.error(`  ◦ [warn] ${e}`)

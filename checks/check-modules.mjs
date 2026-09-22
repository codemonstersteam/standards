#!/usr/bin/env node
// Требование «модуль = один вход, один выход»: в каждом internal/<slug>/
// ровно одна точка входа. internal/shared/ — исключение (общие вещи).
// Запуск: node checks/check-modules.mjs <projectRoot>
// Контракт: exit 0 = OK (строка в stdout); exit 1 = список `✗` в stderr.
// Нет internal/ → OK с пометкой «пропущено» (стандарт применяется к модульной раскладке).
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.argv[2] || process.cwd())
const internalDir = join(root, 'internal')
const errors = []

const ENTRY_BASES = ['index', 'handler', 'request', 'usecase', 'main']
const ENTRY_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.go', '.py']

if (!existsSync(internalDir)) {
  console.log('check-modules: OK — нет internal/, проверка раскладки пропущена')
  process.exit(0)
}

let modules = 0
for (const e of readdirSync(internalDir, { withFileTypes: true })) {
  if (!e.isDirectory() || e.name === 'shared' || e.name.startsWith('.')) continue
  modules++
  const entries = readdirSync(join(internalDir, e.name))
    .filter((f) => {
      const dot = f.lastIndexOf('.')
      if (dot === -1) return false
      return ENTRY_BASES.includes(f.slice(0, dot)) && ENTRY_EXTS.includes(f.slice(dot))
    })
  if (entries.length === 0) {
    errors.push(`internal/${e.name}/ нет точки входа (${ENTRY_BASES.join('|')}) — модуль обязан иметь один вход`)
  } else if (entries.length > 1) {
    errors.push(`internal/${e.name}/ ${entries.length} точки входа (${entries.join(', ')}) — один вход, один выход`)
  }
}

if (errors.length) {
  console.error('check-modules: нарушения правила «один вход, один выход»:')
  for (const e of errors) console.error(`  ✗ ${e}`)
  process.exit(1)
}
console.log(`check-modules: OK — ${modules} модулей, в каждом ровно одна точка входа`)

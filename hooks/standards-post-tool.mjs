#!/usr/bin/env node
// Универсальный hook в Claude-формате для dsh (мост hooks-claude-code) и ZCode.
// Событие: PostToolUse. Вход — JSON на stdin (tool_name, tool_input, cwd);
// по glob-маппингу из standards.json запускает релевантные проверки.
// Нарушения → exit 0 + stdout JSON {"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"✗ ..."}}
// (advisory-режим: модель видит замечания и правит в том же ходу).
// Нет нарушений / файл вне стандартов / непарсимый вход → тихий exit 0.
import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { findProjectRoot, loadManifest, pathMatches, runCheck } from '../lib/common.mjs'

async function main() {
  let raw = ''
  try {
    raw = readFileSync(process.stdin.fd, 'utf8')
  } catch {
    process.exit(0)
  }
  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    process.exit(0)
  }

  const input = payload.tool_input ?? payload.toolInput ?? {}
  const candidates = [input.file_path, input.filePath, input.path, input.notebook_path]
  const filePath = candidates.find((v) => typeof v === 'string' && v.length > 0)
  const cwd = typeof payload.cwd === 'string' ? payload.cwd : process.cwd()

  const violations = []
  if (filePath) {
    const abs = resolve(cwd, filePath)
    const projectRoot = findProjectRoot(dirname(abs), cwd)
    if (!projectRoot) process.exit(0)
    const rel = relative(projectRoot, abs)
    if (rel.startsWith('..')) process.exit(0) // правка вне проекта
    for (const std of loadManifest().standards) {
      for (const check of std.checks ?? []) {
        if (!pathMatches(check.paths, rel)) continue
        const { errors } = runCheck(check.check, projectRoot)
        for (const e of errors) violations.push(`[${std.id}] ${e}`)
      }
    }
  } else {
    // TBD-контроль: агент коммитит — проверяем модель ветвления.
    const command = typeof input.command === 'string' ? input.command : ''
    if (/\bgit\b\s+\w*\s*commit\b/.test(command)) {
      const projectRoot = findProjectRoot(cwd, cwd)
      if (projectRoot) {
        const { errors } = runCheck('check-tbd', projectRoot)
        for (const e of errors) violations.push(`[tbd] ${e}`)
      }
    }
  }
  if (violations.length === 0) process.exit(0)

  const additionalContext =
    `[dev-standards] Нарушения стандартов:\n` +
    violations.map((v) => `  ${v}`).join('\n') +
    `\nИсправь нарушения в этом же ходу. Подробности правил: skills api-spec, component-tests, modules, tbd.`
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext,
      },
    })
  )
  process.exit(0)
}

main().catch(() => process.exit(0)) // fail-open: ошибки хука не мешают работе агента

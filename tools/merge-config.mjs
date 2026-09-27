#!/usr/bin/env node
// Идемпотентный merge конфигов харнесов. Используется install.sh.
// Запуск: node tools/merge-config.mjs <opencode|zcode|pi|claude> <файл> <payload>
//   opencode: payload = путь плагина для массива "plugin" (например "./.opencode/plugins/standards-guard.mjs")
//   zcode:    payload = команда хука (например "node /abs/hooks/standards-post-tool.mjs")
//   pi:       payload = путь к репозиторию стандартов для массива "packages" (~/.pi/agent/settings.json)
//   claude:   payload = команда хука — merge PostToolUse в project .claude/settings.json
// JSONC читается толерантно (комментарии/хвостовые запятые), пишется строгим JSON.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

const [mode, file, payload] = process.argv.slice(2)
if (!mode || !file || !payload || !['opencode', 'zcode', 'pi', 'claude'].includes(mode)) {
  console.error('использование: node tools/merge-config.mjs <opencode|zcode|pi|claude> <файл> <payload>')
  process.exit(1)
}

function readConfig(path) {
  if (!existsSync(path)) return {}
  const raw = readFileSync(path, 'utf8')
  try {
    return JSON.parse(raw)
  } catch {
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:"'\\])\/\/.*$/gm, '$1')
      .replace(/,(\s*[}\]])/g, '$1')
    console.error(`внимание: ${path} содержит JSONC — комментарии будут сняты при перезаписи`)
    return JSON.parse(stripped)
  }
}

const cfg = readConfig(file)

if (mode === 'opencode') {
  const cur = Array.isArray(cfg.plugin) ? cfg.plugin : []
  cfg.plugin = [...cur.filter((p) => !String(p).includes('standards-guard')), payload]
} else if (mode === 'pi') {
  // Локальные пути в packages живут живьём (live-reload при рестарте сессии)
  const cur = Array.isArray(cfg.packages) ? cfg.packages : []
  cfg.packages = [...new Set([...cur, payload])]
} else if (mode === 'claude') {
  // Claude Code: проектный .claude/settings.json коммитится и исполняется.
  cfg.hooks ??= {}
  cfg.hooks.PostToolUse ??= []
  const cur = cfg.hooks.PostToolUse
  cfg.hooks.PostToolUse = [
    ...cur.filter((e) => !JSON.stringify(e).includes('standards-post-tool')),
    { matcher: 'Write|Edit', hooks: [{ type: 'command', command: payload }] },
  ]
} else {
  // zcode: hooks только из user-конфига; бэкап снимаем один раз (pristine).
  if (existsSync(file) && !existsSync(`${file}.bak-dev-standards`)) {
    copyFileSync(file, `${file}.bak-dev-standards`)
  }
  cfg.hooks ??= {}
  cfg.hooks.enabled = true
  cfg.hooks.events ??= {}
  const cur = Array.isArray(cfg.hooks.events.PostToolUse) ? cfg.hooks.events.PostToolUse : []
  const entry = {
    matcher: 'write|edit|Write|Edit',
    hooks: [{ type: 'command', command: payload }],
  }
  cfg.hooks.events.PostToolUse = [
    ...cur.filter((e) => !JSON.stringify(e).includes('standards-post-tool')),
    entry,
  ]
}

writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n')
console.log(`${mode}: ${file} обновлён`)

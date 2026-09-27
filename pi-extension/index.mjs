// pi-расширение dev-standards: advisory-петля проверок после правок файлов.
// У pi нет hooks-конфига и MCP — единственная поверхность контроля это события
// extension-API (docs/extensions.md): tool_result (можно модифицировать результат,
// патч {content,...}) — эквивалент PostToolUse-additionalContext у dsh/ZCode.
// Подключение: пакет в package.json ("pi": {"extensions": [...], "skills": [...]})
// + `pi install <путь к репо>` или запись в ~/.pi/agent/settings.json (packages).
import { dirname, relative, resolve } from 'node:path'
import { findProjectRoot, loadManifest, pathMatches, runCheck } from '../lib/common.mjs'

function collectViolations(input, cwd) {
  const candidates = [input?.path, input?.file_path, input?.filePath]
  const filePath = candidates.find((v) => typeof v === 'string' && v.length > 0)
  const violations = []
  if (filePath) {
    const abs = resolve(cwd, filePath)
    const projectRoot = findProjectRoot(dirname(abs), cwd)
    if (projectRoot) {
      const rel = relative(projectRoot, abs)
      if (!rel.startsWith('..')) {
        for (const std of loadManifest().standards) {
          for (const check of std.checks ?? []) {
            if (!pathMatches(check.paths, rel)) continue
            const { errors } = runCheck(check.check, projectRoot)
            for (const e of errors) violations.push(`[${std.id}] ${e}`)
          }
        }
      }
    }
  } else if (typeof input?.command === 'string' && /\bgit\b\s+\w*\s*commit\b/.test(input.command)) {
    // TBD-контроль: агент коммитит — проверяем модель ветвления
    const projectRoot = findProjectRoot(cwd, cwd)
    if (projectRoot) {
      const { errors } = runCheck('check-tbd', projectRoot)
      for (const e of errors) violations.push(`[tbd] ${e}`)
    }
  }
  return violations
}

const note = (violations) =>
  `[dev-standards] Нарушения стандартов:\n` +
  violations.map((v) => `  ${v}`).join('\n') +
  `\nИсправь нарушения в этом же ходу. Подробности правил: skills box-spec, component-tests, modules, tbd, release.`

export default function register(pi) {
  pi.on('tool_result', async (event) => {
    try {
      if (event.toolName !== 'write' && event.toolName !== 'edit' && event.toolName !== 'bash') return
      const violations = collectViolations(event.input, process.cwd())
      if (violations.length === 0) return
      const text = note(violations)
      // event.content у pi — массив блоков; патчим консервативно, оба варианта.
      const content = Array.isArray(event.content)
        ? [...event.content, { type: 'text', text }]
        : typeof event.content === 'string'
          ? event.content + '\n' + text
          : [{ type: 'text', text }]
      return { content }
    } catch {
      // fail-open: ошибка расширения не мешает агенту
    }
  })
}

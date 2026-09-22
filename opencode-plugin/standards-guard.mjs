// Плагин opencode: детерминированные проверки стандартов при правке файлов.
// Самодостаточный файл (только node:-встроенные модули, без relative-импортов) —
// по образцу rational-guardrail.mjs, чтобы opencode не зависел от трансляции
// и npm-пакетов. Регистрация: симлинк в <proj>/.opencode/plugins/ +
// "plugin": ["./.opencode/plugins/standards-guard.mjs"] в opencode.json(c).
//
// Обратная связь модели — throw в tool.execute.before (проверенный канал opencode):
//   - write с контентом  → контент проверяется через temp-файл (будущее состояние);
//   - edit / без контента → проверка текущего состояния файла на диске.
// Инфраструктурные ошибки проглатываются (fail-open), нарушения — бросаются.
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(realpathSync(fileURLToPath(import.meta.url)))) // opencode-plugin/ -> репо

function loadManifest() {
  return JSON.parse(readFileSync(join(ROOT, 'standards.json'), 'utf8'))
}

function globToRegExp(pattern) {
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*'
        i++
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp('^' + re + '$')
}

function relevantChecks(rel) {
  const out = []
  for (const std of loadManifest().standards) {
    for (const check of std.checks ?? []) {
      if ((check.paths || []).some((p) => globToRegExp(p).test(rel))) out.push({ id: std.id, ...check })
    }
  }
  return out
}

function runCheck(check, projectRoot, extraArgs = []) {
  const r = spawnSync(
    process.execPath,
    [join(ROOT, 'checks', `${check}.mjs`), projectRoot, ...extraArgs],
    { encoding: 'utf8' }
  )
  return String(r.stderr || '')
    .split(/\r?\n/)
    .filter((l) => l.includes('✗'))
    .map((l) => `[${check.replace(/^check-/, '')}] ${l.trim()}`)
}

function findProjectRoot(startDir, fallback) {
  let dir = resolve(startDir)
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return fallback ? resolve(fallback) : null
    dir = parent
  }
}

export const StandardsGuard = async ({ directory, worktree } = {}) => {
  return {
    'tool.execute.before': async (input, output) => {
      try {
        const tool = String(input?.tool ?? output?.tool ?? '').toLowerCase()
        if (tool !== 'write' && tool !== 'edit') return
        const args = output?.args ?? input?.args ?? {}
        const rawPath = args.filePath ?? args.file_path ?? args.path
        if (typeof rawPath !== 'string' || !rawPath) return
        const baseDir = directory ?? worktree ?? process.cwd()
        const abs = resolve(baseDir, rawPath)
        const projectRoot = findProjectRoot(dirname(abs), baseDir)
        if (!projectRoot) return
        const rel = relative(projectRoot, abs)
        if (rel.startsWith('..')) return

        const checks = relevantChecks(rel)
        if (checks.length === 0) return

        const violations = []
        const isApiSpecWrite = tool === 'write' && checks.some((c) => c.check === 'check-api-spec')
        const content = args.content ?? args.body ?? args.text

        if (isApiSpecWrite && typeof content === 'string') {
          // Валидируем будущее состояние: контент write во временный файл с тем же именем.
          const tmpDir = mkdtempSync(join(tmpdir(), 'dev-standards-'))
          const tmpFile = join(tmpDir, rel.split('/').pop())
          writeFileSync(tmpFile, content)
          try {
            for (const c of checks) {
              if (c.check !== 'check-api-spec') continue
              violations.push(...runCheck('check-api-spec', projectRoot, ['--spec', tmpFile]))
            }
          } finally {
            rmSync(tmpDir, { recursive: true, force: true })
          }
        } else {
          for (const c of checks) violations.push(...runCheck(c.check, projectRoot))
        }

        const unique = [...new Set(violations)]
        if (unique.length > 0) {
          throw new Error(
            `[dev-standards] Нарушения стандартов:\n` +
              unique.map((v) => `  ${v}`).join('\n') +
              `\nИсправь нарушения до продолжения. Подробности: skills \`api-spec\`, \`component-tests\`.`
          )
        }
      } catch (e) {
        if (String(e?.message || '').startsWith('[dev-standards]')) throw e // наши нарушения — наружу
        // прочее — инфраструктурная ошибка: fail-open, не мешаем агенту
      }
    },
  }
}

export default StandardsGuard

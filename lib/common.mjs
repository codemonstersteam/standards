// Общие утилиты dev-standards. Zero-dep, Node >= 18.
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Корень репозитория стандартов: lib/ -> на уровень выше. realpath — чтобы
// скрипты находили репо даже когда на них указывает симлинк из проекта.
export const ROOT = dirname(dirname(realpathSync(fileURLToPath(import.meta.url))))

export function loadManifest() {
  return JSON.parse(readFileSync(join(ROOT, 'standards.json'), 'utf8'))
}

// Поддерживаем только нужное подмножество: `*`, `**`, `?`.
export function globToRegExp(pattern) {
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

export function pathMatches(patterns, relPath) {
  return patterns.some((p) => globToRegExp(p).test(relPath))
}

// Ближайший предок с .git; если нет — fallback (например, cwd хука).
export function findProjectRoot(startDir, fallback) {
  let dir = resolve(startDir)
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return fallback ? resolve(fallback) : null
    dir = parent
  }
}

export function walkFiles(dir, suffix, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walkFiles(p, suffix, out)
    else if (e.name.endsWith(suffix)) out.push(p)
  }
  return out
}

// Gherkin-lite: теги наследуются от Feature, теги перед Scenario относятся к нему.
// Теги нормализуются без префикса `@` (smoke, wip) — сравнение по имени.
export function parseFeature(text) {
  const scenarios = []
  let featureTags = []
  let pending = []
  let seenFeature = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (/^(@[\w-]+\s*)+$/.test(line)) {
      pending.push(...line.split(/\s+/).map((t) => t.slice(1)))
      continue
    }
    const m = line.match(/^(?:Scenario|Сценарий|Scenario Outline|Структура сценария)\s*:\s*(.*)$/i)
    if (m) {
      const inherited = seenFeature ? featureTags : []
      scenarios.push({ name: m[1].trim(), tags: [...new Set([...inherited, ...pending])] })
      pending = []
      continue
    }
    if (/^(?:Feature|Функциональность|Функция)\s*:/i.test(line)) {
      featureTags = pending
      pending = []
      seenFeature = true
      continue
    }
    pending = [] // прочие строки (Background, шаги) отвязывают накопленные теги
  }
  return { scenarios, featureTags }
}

// Единый контракт запуска проверки: node checks/<name>.mjs <projectRoot> [extra...]
// Возвращает { ok, errors }, errors — строки `✗ ...` из stderr.
export function runCheck(checkName, projectRoot, extraArgs = []) {
  const r = spawnSync(
    process.execPath,
    [join(ROOT, 'checks', `${checkName}.mjs`), projectRoot, ...extraArgs],
    { encoding: 'utf8' }
  )
  const errors = String(r.stderr || '')
    .split(/\r?\n/)
    .filter((l) => l.includes('✗'))
    .map((l) => l.trim())
  return { ok: r.status === 0, errors }
}

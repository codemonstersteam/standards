#!/usr/bin/env node
// Требование TBD: один trunk, короткие feature-ветки, маленькие PR.
// Запуск: node checks/check-tbd.mjs <projectRoot>
// Контракт: exit 0 = OK (строка в stdout); exit 1 = список `✗` в stderr.
// Не git-репозиторий → OK с пометкой «пропущено».
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

// Что проверяет чекер — источник для генератора скиллов (tools/generate.mjs).
export const meta = {
  what: [
    'коммит напрямую в trunk/main/master — запрещено;',
    'дифф ветки против trunk > 600 добавленных строк;',
    'возраст ветки (от первого коммита ветки) > 2 дней.',
  ],
  notes:
    '«Ветка от ветки» скриптом не ловится — держи правило сознательно. Не git-репозиторий —\nпроверка мягко пропускается.',
}
if (process.argv.includes('--meta')) {
  console.log(JSON.stringify(meta))
  process.exit(0)
}

const root = resolve(process.argv[2] || process.cwd())
const errors = []
const git = (args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' })

const isRepo = git(['rev-parse', '--is-inside-work-tree'])
if (!(isRepo.status === 0 && String(isRepo.stdout).trim() === 'true')) {
  console.log('check-tbd: OK — не git-репозиторий, проверка пропущена')
  process.exit(0)
}

const TRUNKS = ['trunk', 'main', 'master']
const branch = String(git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout || '').trim()
// greenfield-пропуск: в проекте ровно один коммит — bootstrap на trunk легален
const count = git(['rev-list', '--count', 'HEAD'])
const isGreenfield = count.status === 0 && String(count.stdout).trim() === '1'
let trunk = null
for (const t of TRUNKS) {
  if (git(['rev-parse', '--verify', '--quiet', `refs/heads/${t}`]).status === 0) {
    trunk = t
    break
  }
}

if (trunk && TRUNKS.includes(branch) && !isGreenfield) {
  errors.push(`коммит напрямую в \`${branch}\` запрещён — работай в feature-ветке, вливай через PR`)
}

if (trunk && branch && branch !== trunk) {
  // Размер диффа ветки против trunk (добавленные строки).
  const diff = git(['diff', `${trunk}...HEAD`])
  if (diff.status === 0) {
    const added = diff.stdout
      .split('\n')
      .filter((l) => l.startsWith('+') && !l.startsWith('+++')).length
    if (added > 600) {
      errors.push(`дифф ветки \`${branch}\` — ${added} добавленных строк > 600 (один тикет = один PR ≤ 600 строк)`)
    }
  }

  // Возраст ветки: дата первого коммита ветки (после ответвления от trunk).
  const list = git(['rev-list', '--reverse', `${trunk}..HEAD`])
  if (list.status === 0 && list.stdout.trim()) {
    const first = list.stdout.split('\n')[0].trim()
    const date = git(['show', '-s', '--format=%ct', first])
    const days = (Date.now() / 1000 - Number(date.stdout)) / 86400
    if (days > 2) {
      errors.push(`ветка \`${branch}\` живёт ${days.toFixed(1)} дн. > 2 — режь ветки короче или влей`)
    }
  }
}

if (errors.length) {
  console.error('check-tbd: нарушения trunk-based development:')
  for (const e of errors) console.error(`  ✗ ${e}`)
  process.exit(1)
}
console.log(`check-tbd: OK — ветка \`${branch || '?'}\`${trunk ? `, trunk=${trunk}` : ' (trunk не найден)'} соответствует TBD`)

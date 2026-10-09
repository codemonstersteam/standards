// Мини-парсер YAML (restricted subset) для rules/*.yaml. Zero-dep, Node >= 18.
// Полный YAML не нужен: формат контролируем этим репозиторием.
// Поддерживает: вложенные map, списки (скаляры, map-элементы «- ключ: значение»,
// вложенные блоки), block scalars (| и >, с модификаторами -), скаляры
// (строки/числа/bool/null, кавычки), inline-списки скаляров ([a, b]),
// комментарии (#), разделитель документа ---.
// Fail-closed: всё непонятное — Error с номером строки.

export function parseYaml(text) {
  const raw = text.split(/\r?\n/)
  let pos = 0

  const fail = (msg, n) => {
    throw new Error(`YAML: ${msg} — строка ${n}`)
  }

  function stripComment(l) {
    let inS = false
    let inD = false
    for (let i = 0; i < l.length; i++) {
      const c = l[i]
      if (c === "'" && !inD) inS = !inS
      else if (c === '"' && !inS) inD = !inD
      else if (c === '#' && !inS && !inD && (i === 0 || l[i - 1] === ' ')) return l.slice(0, i)
    }
    return l
  }

  // Структурный вид строки: без комментария и хвостовых пробелов; null = пропустить.
  function view(idx) {
    const l = raw[idx]
    const lead = l.slice(0, l.length - l.trimStart().length)
    if (lead.includes('\t')) fail('табуляция в отступе (используй пробелы)', idx + 1)
    const t = stripComment(l).replace(/\s+$/, '')
    if (!t.trim()) return null
    if (t.trim() === '---' || t.trim() === '...') return null
    return { n: idx + 1, indent: t.match(/^ */)[0].length, text: t.trim() }
  }

  function peek() {
    while (pos < raw.length) {
      const v = view(pos)
      if (v) return v
      pos++
    }
    return null
  }

  const KEY = /^(?:"([^"]*)"|'([^']*)'|([^:\s][^:]*?))\s*:\s*(.*)$/
  const BLOCK_HEADER = /^[|>]-?$/

  function parseBlock(indent) {
    const line = peek()
    if (!line) fail('ожидалось значение, а файл кончился', raw.length)
    if (line.text === '-' || line.text.startsWith('- ')) return parseList(indent)
    return parseMap(indent)
  }

  function parseMap(indent) {
    const out = {}
    for (;;) {
      const line = peek()
      if (!line || line.indent < indent) return out
      if (line.indent > indent) fail(`неожиданный отступ ${line.indent} (ожидался ${indent})`, line.n)
      if (line.text === '-' || line.text.startsWith('- ')) {
        fail('элемент списка там, где ждали «ключ: значение»', line.n)
      }
      const m = line.text.match(KEY)
      if (!m) fail(`не понял строку (ожидал «ключ: значение»): «${line.text.slice(0, 40)}»`, line.n)
      const key = m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]
      const rest = m[4]
      pos++
      if (rest) {
        if (BLOCK_HEADER.test(rest)) out[key] = readBlockScalar(indent, rest)
        else out[key] = parseInline(rest, line.n)
      } else {
        const next = peek()
        if (next && next.indent > indent) out[key] = parseBlock(next.indent)
        else if (next && next.indent === indent && (next.text === '-' || next.text.startsWith('- '))) {
          out[key] = parseList(indent)
        } else out[key] = null
      }
    }
  }

  function isMapStart(s) {
    const m = s.match(/^(?:"[^"]*"|'[^']*'|[^:\s][^:]*?)\s*:(\s|$)/)
    return Boolean(m)
  }

  function parseList(indent) {
    const out = []
    for (;;) {
      const line = peek()
      if (!line || line.indent < indent) return out
      if (line.indent > indent) fail(`неожиданный отступ ${line.indent} в списке`, line.n)
      if (!(line.text === '-' || line.text.startsWith('- '))) return out
      const rest = line.text === '-' ? '' : line.text.slice(2)
      if (!rest) {
        pos++
        const next = peek()
        if (next && next.indent > indent) out.push(parseBlock(next.indent))
        else out.push(null)
      } else if (BLOCK_HEADER.test(rest)) {
        pos++
        out.push(readBlockScalar(indent, rest))
      } else if (isMapStart(rest)) {
        // «- ключ: значение» → виртуальная строка с отступом после дефиса
        raw[pos] = ' '.repeat(line.indent + 2) + rest
        out.push(parseMap(line.indent + 2))
      } else {
        out.push(parseScalar(rest, line.n))
        pos++
      }
    }
  }

  function readBlockScalar(parentIndent, header) {
    if (header.length > 1 && header[1] === '+') fail('модификатор «+» не поддерживается', pos + 1)
    const fold = header[0] === '>'
    const strip = header.endsWith('-')
    const lines = []
    let contentIndent = null
    while (pos < raw.length) {
      const l = raw[pos]
      if (l.trim() === '') {
        lines.push(null)
        pos++
        continue
      }
      const ind = l.match(/^ */)[0].length
      if (ind <= parentIndent) break
      if (l.slice(0, ind).includes('\t')) fail('табуляция в отступе', pos + 1)
      if (contentIndent === null) contentIndent = ind
      if (ind < contentIndent) fail(`отступ ${ind} меньше базового ${contentIndent} block scalar`, pos + 1)
      lines.push(l.slice(contentIndent))
      pos++
    }
    while (lines.length && lines[lines.length - 1] === null) lines.pop()
    let out
    if (fold) {
      out = ''
      let prevText = false
      for (const l of lines) {
        if (l === null) {
          out += '\n'
          prevText = false
        } else {
          if (prevText) out += ' '
          out += l
          prevText = true
        }
      }
    } else {
      out = lines.map((l) => (l === null ? '' : l)).join('\n')
    }
    return strip ? out : out + '\n'
  }

  function splitTop(s) {
    const out = []
    let cur = ''
    let inS = false
    let inD = false
    for (const c of s) {
      if (c === "'" && !inD) inS = !inS
      else if (c === '"' && !inS) inD = !inD
      if (c === ',' && !inS && !inD) {
        out.push(cur)
        cur = ''
      } else cur += c
    }
    out.push(cur)
    return out
  }

  function parseInline(s, n) {
    s = s.trim()
    if (s.startsWith('[')) {
      if (!s.endsWith(']')) fail('незакрытый inline-список', n)
      const inner = s.slice(1, -1).trim()
      if (!inner) return []
      return splitTop(inner).map((p) => parseScalar(p.trim(), n))
    }
    return parseScalar(s, n)
  }

  function parseScalar(s, n) {
    s = s.trim()
    if (s === '') return null
    if (s.startsWith('"')) {
      try {
        return JSON.parse(s)
      } catch {
        fail(`не разобрать двойные кавычки: ${s.slice(0, 30)}`, n)
      }
    }
    if (s.startsWith("'")) {
      if (!s.endsWith("'")) fail('незакрытые одинарные кавычки', n)
      return s.slice(1, -1).replace(/''/g, "'")
    }
    if (/^-?\d+$/.test(s)) return Number(s)
    if (/^-?\d+\.\d+$/.test(s)) return Number(s)
    if (s === 'true' || s === 'false') return s === 'true'
    if (s === 'null' || s === '~') return null
    return s
  }

  const doc = parseMap(0)
  const extra = peek()
  if (extra) fail(`лишний контент вне корневой map: «${extra.text.slice(0, 30)}»`, extra.n)
  return doc
}

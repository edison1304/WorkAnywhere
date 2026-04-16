import { useMemo } from 'react'
import styles from './ArtifactViewer.module.css'

interface Props {
  content: string
  fileName: string
}

// ─── VS Code Dark+ token colors ───
const T = {
  keyword: '#569cd6',
  control: '#c586c0',
  type: '#4ec9b0',
  function: '#dcdcaa',
  string: '#ce9178',
  number: '#b5cea8',
  comment: '#6a9955',
  operator: '#d4d4d4',
  punctuation: '#808080',
  variable: '#9cdcfe',
  property: '#9cdcfe',
  constant: '#4fc1ff',
  regex: '#d16969',
  decorator: '#dcdcaa',
  default: '#d4d4d4',
}

type Token = { text: string; color: string }

// ─── Tokenizer ───
function tokenizeLine(line: string, lang: string, inBlock: boolean): { tokens: Token[]; inBlock: boolean } {
  if (inBlock) {
    const end = line.indexOf('*/')
    if (end === -1) return { tokens: [{ text: line, color: T.comment }], inBlock: true }
    return {
      tokens: [
        { text: line.slice(0, end + 2), color: T.comment },
        ...tokenizeLine(line.slice(end + 2), lang, false).tokens,
      ],
      inBlock: false,
    }
  }

  const tokens: Token[] = []
  let remaining = line
  const push = (text: string, color: string) => { if (text) tokens.push({ text, color }) }

  while (remaining.length > 0) {
    if (remaining.startsWith('/*')) {
      const end = remaining.indexOf('*/', 2)
      if (end === -1) { push(remaining, T.comment); return { tokens, inBlock: true } }
      push(remaining.slice(0, end + 2), T.comment); remaining = remaining.slice(end + 2); continue
    }

    const commentPrefixes = ['python', 'shell', 'ruby', 'yaml', 'toml'].includes(lang) ? ['#'] : ['//', '#']
    let isComment = false
    for (const cp of commentPrefixes) {
      if (remaining.startsWith(cp)) { push(remaining, T.comment); remaining = ''; isComment = true; break }
    }
    if (isComment) continue

    // Triple-quoted strings (Python)
    const tripleMatch = remaining.match(/^("""[\s\S]*?"""|'''[\s\S]*?''')/)
    if (tripleMatch) { push(tripleMatch[0], T.string); remaining = remaining.slice(tripleMatch[0].length); continue }

    const strMatch = remaining.match(/^(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/)
    if (strMatch) { push(strMatch[0], T.string); remaining = remaining.slice(strMatch[0].length); continue }

    if (remaining.startsWith('@')) {
      const m = remaining.match(/^@[\w.]+/)
      if (m) { push(m[0], T.decorator); remaining = remaining.slice(m[0].length); continue }
    }

    const numMatch = remaining.match(/^(?:0[xX][\da-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?)\b/)
    if (numMatch) { push(numMatch[0], T.number); remaining = remaining.slice(numMatch[0].length); continue }

    const wordMatch = remaining.match(/^[a-zA-Z_$][\w$]*/)
    if (wordMatch) {
      const w = wordMatch[0]
      push(w, getWordColor(w, remaining.slice(w.length)))
      remaining = remaining.slice(w.length); continue
    }

    const opMatch = remaining.match(/^(?:=>|===|!==|==|!=|<=|>=|&&|\|\||<<|>>|\?\?|\?\.|\.\.\.|[+\-*/%=<>!&|^~?:])/)
    if (opMatch) { push(opMatch[0], T.operator); remaining = remaining.slice(opMatch[0].length); continue }

    if ('(){}[];,.'.includes(remaining[0])) { push(remaining[0], T.punctuation); remaining = remaining.slice(1); continue }

    push(remaining[0], T.default); remaining = remaining.slice(1)
  }
  return { tokens, inBlock: false }
}

const CONTROL = new Set(['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'return', 'try', 'catch', 'finally', 'throw', 'yield', 'await', 'async', 'match', 'loop', 'elif', 'except', 'raise', 'pass', 'with'])
const DECLARE = new Set(['const', 'let', 'var', 'function', 'class', 'interface', 'type', 'enum', 'struct', 'import', 'export', 'from', 'as', 'default', 'extends', 'implements', 'public', 'private', 'protected', 'static', 'abstract', 'override', 'readonly', 'def', 'fn', 'func', 'pub', 'mod', 'use', 'crate', 'trait', 'impl', 'package', 'namespace', 'module', 'lambda'])
const TYPES = new Set(['string', 'number', 'boolean', 'void', 'null', 'undefined', 'never', 'any', 'unknown', 'int', 'float', 'double', 'char', 'bool', 'i32', 'i64', 'u32', 'u64', 'f32', 'f64', 'str', 'Vec', 'Option', 'Result', 'String', 'Array', 'Map', 'Set', 'Promise', 'List', 'Dict', 'Tuple', 'Optional'])
const CONSTANTS = new Set(['true', 'false', 'null', 'undefined', 'None', 'True', 'False', 'nil', 'NaN', 'Infinity', 'self', 'this', 'super', 'Self'])

function getWordColor(word: string, after: string): string {
  if (CONSTANTS.has(word)) return T.constant
  if (CONTROL.has(word)) return T.control
  if (TYPES.has(word)) return T.type
  if (DECLARE.has(word)) return T.keyword
  if (after.trimStart().startsWith('(')) return T.function
  if (/^[A-Z][A-Z0-9_]+$/.test(word)) return T.constant
  if (/^[A-Z][a-zA-Z0-9]+$/.test(word)) return T.type
  return T.default
}

function getLang(ext: string): string {
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', java: 'java', c: 'c', cpp: 'cpp', h: 'c',
    css: 'css', scss: 'css', html: 'html', xml: 'html',
    sh: 'shell', bash: 'shell', zsh: 'shell',
    sql: 'sql', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    json: 'json', md: 'markdown', dockerfile: 'shell', makefile: 'shell',
  }
  return map[ext] || 'text'
}

const langLabel: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript',
  py: 'Python', rs: 'Rust', go: 'Go', java: 'Java', c: 'C', cpp: 'C++',
  h: 'C Header', css: 'CSS', scss: 'SCSS', html: 'HTML',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell', sql: 'SQL',
  yaml: 'YAML', yml: 'YAML', toml: 'TOML', json: 'JSON', xml: 'XML',
  dockerfile: 'Dockerfile', makefile: 'Makefile',
}

// ─── Indentation guide helper ───
function getIndentLevel(line: string, tabSize: number): number {
  let spaces = 0
  for (const ch of line) {
    if (ch === ' ') spaces++
    else if (ch === '\t') spaces += tabSize
    else break
  }
  return Math.floor(spaces / tabSize)
}

export function CodeViewer({ content, fileName }: Props) {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  const lang = getLang(ext)
  const label = langLabel[ext] || ext.toUpperCase()
  const tabSize = ['python', 'rust', 'c', 'cpp'].includes(lang) ? 4 : (['yaml', 'html', 'css'].includes(lang) ? 2 : 4)

  const highlighted = useMemo(() => {
    const lines = content.split('\n')
    const result: { tokens: Token[]; indent: number }[] = []
    let inBlock = false
    for (const line of lines) {
      const { tokens, inBlock: newBlock } = tokenizeLine(line, lang, inBlock)
      result.push({ tokens, indent: getIndentLevel(line, tabSize) })
      inBlock = newBlock
    }
    return result
  }, [content, lang, tabSize])

  const lineNumWidth = String(highlighted.length).length

  return (
    <div className={styles.codeViewer}>
      <div className={styles.codeHeader}>
        <span className={styles.codeLang}>{label}</span>
        <span className={styles.codeLines}>{highlighted.length} lines</span>
      </div>
      <div className={styles.codeBody}>
        <pre className={styles.codePre}>
          <code>
            {highlighted.map(({ tokens, indent }, i) => (
              <div key={i} className={styles.codeLine}>
                <span className={styles.lineNum} style={{ minWidth: (lineNumWidth * 8) + 24 }}>
                  {i + 1}
                </span>
                <span className={styles.lineContent}>
                  {/* Indentation guides */}
                  {indent > 0 && Array.from({ length: indent }, (_, g) => (
                    <span
                      key={g}
                      className={styles.indentGuide}
                      style={{ left: g * tabSize * 7.8 }}
                    />
                  ))}
                  {tokens.length === 0
                    ? '\n'
                    : tokens.map((t, j) => (
                        <span key={j} style={{ color: t.color }}>{t.text}</span>
                      ))
                  }
                </span>
              </div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  )
}

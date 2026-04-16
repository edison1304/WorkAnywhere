import { useRef, useEffect } from 'react'
import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import styles from './ArtifactViewer.module.css'

// Use local monaco-editor instead of CDN (Electron offline support)
loader.config({ monaco })

interface Props {
  content: string
  fileName: string
}

const extToLang: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', rs: 'rust', go: 'go', java: 'java', c: 'c', cpp: 'cpp', h: 'c',
  css: 'css', scss: 'scss', less: 'less', html: 'html', xml: 'xml',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  sql: 'sql', yaml: 'yaml', yml: 'yaml', toml: 'ini',
  json: 'json', md: 'markdown', csv: 'plaintext',
  dockerfile: 'dockerfile', makefile: 'plaintext',
  rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin',
  r: 'r', lua: 'lua', pl: 'perl', m: 'objective-c',
}

const langLabel: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript',
  py: 'Python', rs: 'Rust', go: 'Go', java: 'Java', c: 'C', cpp: 'C++',
  h: 'C Header', css: 'CSS', scss: 'SCSS', html: 'HTML',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell', sql: 'SQL',
  yaml: 'YAML', yml: 'YAML', toml: 'TOML', json: 'JSON', xml: 'XML',
  dockerfile: 'Dockerfile', makefile: 'Makefile', md: 'Markdown',
  rb: 'Ruby', php: 'PHP', swift: 'Swift', kt: 'Kotlin',
}

export function CodeViewer({ content, fileName }: Props) {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  const language = extToLang[ext] || 'plaintext'
  const label = langLabel[ext] || ext.toUpperCase() || 'Text'
  const lineCount = content.split('\n').length

  return (
    <div className={styles.codeViewer}>
      <div className={styles.codeHeader}>
        <span className={styles.codeLang}>{label}</span>
        <span className={styles.codeLines}>{lineCount} lines</span>
      </div>
      <div className={styles.codeBody}>
        <Editor
          language={language}
          value={content}
          theme="vs-dark"
          options={{
            readOnly: true,
            domReadOnly: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 14,
            lineHeight: 19,
            fontFamily: "Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
            lineNumbers: 'on',
            renderLineHighlight: 'none',
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            scrollbar: {
              vertical: 'auto',
              horizontal: 'auto',
              verticalScrollbarSize: 10,
              horizontalScrollbarSize: 10,
            },
            contextmenu: false,
            selectionHighlight: false,
            occurrencesHighlight: 'off',
            renderWhitespace: 'none',
            guides: {
              indentation: true,
              bracketPairs: false,
            },
            folding: true,
            glyphMargin: false,
            padding: { top: 4, bottom: 4 },
            automaticLayout: true,
          }}
        />
      </div>
    </div>
  )
}

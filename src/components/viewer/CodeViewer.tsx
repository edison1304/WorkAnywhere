import styles from './ArtifactViewer.module.css'

interface Props {
  content: string
  fileName: string
}

export function CodeViewer({ content, fileName }: Props) {
  const lines = content.split('\n')
  const ext = fileName.split('.').pop()?.toLowerCase() || ''

  // Simple language label
  const langMap: Record<string, string> = {
    ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript',
    py: 'Python', rs: 'Rust', go: 'Go', java: 'Java', c: 'C', cpp: 'C++',
    h: 'C Header', css: 'CSS', scss: 'SCSS', html: 'HTML',
    sh: 'Shell', bash: 'Shell', zsh: 'Shell',
    sql: 'SQL', yaml: 'YAML', yml: 'YAML', toml: 'TOML',
    json: 'JSON', xml: 'XML', csv: 'CSV',
    dockerfile: 'Dockerfile', makefile: 'Makefile',
  }
  const lang = langMap[ext] || ext.toUpperCase()

  return (
    <div className={styles.codeViewer}>
      <div className={styles.codeHeader}>
        <span className={styles.codeLang}>{lang}</span>
        <span className={styles.codeLines}>{lines.length} lines</span>
      </div>
      <div className={styles.codeBody}>
        <pre className={styles.codePre}>
          <code>
            {lines.map((line, i) => (
              <div key={i} className={styles.codeLine}>
                <span className={styles.lineNum}>{i + 1}</span>
                <span className={styles.lineContent}>{line}</span>
              </div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  )
}

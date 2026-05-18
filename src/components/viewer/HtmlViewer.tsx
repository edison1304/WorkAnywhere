import { useState } from 'react'
import styles from './ArtifactViewer.module.css'

interface Props {
  content: string
  fileName: string
}

export function HtmlViewer({ content, fileName }: Props) {
  const [mode, setMode] = useState<'preview' | 'source'>('preview')

  // Create a sandboxed blob URL for the iframe
  const blob = new Blob([content], { type: 'text/html' })
  const blobUrl = URL.createObjectURL(blob)

  return (
    <div className={styles.htmlViewer}>
      <div className={styles.htmlToolbar}>
        <span className={styles.htmlFileName}>{fileName}</span>
        <div className={styles.htmlTabs}>
          <button
            className={mode === 'preview' ? styles.htmlTabActive : styles.htmlTab}
            onClick={() => setMode('preview')}
          >
            Preview
          </button>
          <button
            className={mode === 'source' ? styles.htmlTabActive : styles.htmlTab}
            onClick={() => setMode('source')}
          >
            Source
          </button>
        </div>
      </div>
      {mode === 'preview' ? (
        <iframe
          src={blobUrl}
          className={styles.htmlFrame}
          sandbox="allow-scripts allow-same-origin"
          title={fileName}
        />
      ) : (
        <pre className={styles.htmlSource}><code>{content}</code></pre>
      )}
    </div>
  )
}

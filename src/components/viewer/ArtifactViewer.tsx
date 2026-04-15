import { useState, useEffect } from 'react'
import type { Artifact } from '../../../shared/types'
import { CodeViewer } from './CodeViewer'
import { MarkdownViewer } from './MarkdownViewer'
import { ImageViewer } from './ImageViewer'
import { PdfViewer } from './PdfViewer'
import styles from './ArtifactViewer.module.css'

interface Props {
  artifact: Artifact
  workspacePath: string
}

type LoadState =
  | { status: 'loading' }
  | { status: 'loaded'; content: string; encoding: 'utf8' | 'base64'; size: number }
  | { status: 'error'; error: string }

export function ArtifactViewer({ artifact, workspacePath }: Props) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  const fullPath = artifact.filePath.startsWith('/')
    ? artifact.filePath
    : `${workspacePath.replace(/\/$/, '')}/${artifact.filePath}`

  useEffect(() => {
    setState({ status: 'loading' })
    if (!window.api) {
      setState({ status: 'error', error: 'API not available' })
      return
    }
    let cancelled = false
    window.api.sshReadFile(fullPath).then(result => {
      if (cancelled) return
      if (result.success && result.content !== undefined) {
        setState({
          status: 'loaded',
          content: result.content,
          encoding: result.encoding || 'utf8',
          size: result.size || 0,
        })
      } else {
        setState({ status: 'error', error: result.error || 'Failed to read file' })
      }
    })
    return () => { cancelled = true }
  }, [fullPath])

  const fileName = artifact.filePath.split('/').pop() || artifact.filePath
  const ext = fileName.split('.').pop()?.toLowerCase() || ''

  if (state.status === 'loading') {
    return (
      <div className={styles.viewerLoading}>
        <div className={styles.spinner} />
        <span>Loading {fileName}...</span>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className={styles.viewerError}>
        <span className={styles.viewerErrorIcon}>!</span>
        <span>{state.error}</span>
        <span className={styles.viewerErrorPath}>{fullPath}</span>
      </div>
    )
  }

  const { content, encoding } = state

  // Route to appropriate viewer
  if (ext === 'pdf') {
    return <PdfViewer content={content} fileName={fileName} />
  }

  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico'].includes(ext)) {
    return <ImageViewer content={content} fileName={fileName} />
  }

  if (['md', 'markdown'].includes(ext) && encoding === 'utf8') {
    return <MarkdownViewer content={content} />
  }

  // Everything else as code/text
  if (encoding === 'utf8') {
    return <CodeViewer content={content} fileName={fileName} />
  }

  // Binary fallback
  return (
    <div className={styles.viewerError}>
      <span>Binary file ({ext}) - preview not supported</span>
      <span className={styles.viewerErrorPath}>{fullPath}</span>
    </div>
  )
}

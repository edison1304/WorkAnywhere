import { useState } from 'react'
import styles from './ArtifactViewer.module.css'

interface Props {
  content: string  // base64 encoded
  fileName: string
}

const mimeMap: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp',
  svg: 'image/svg+xml', ico: 'image/x-icon',
}

export function ImageViewer({ content, fileName }: Props) {
  const [zoom, setZoom] = useState(1)
  const ext = fileName.split('.').pop()?.toLowerCase() || 'png'
  const mime = mimeMap[ext] || 'image/png'
  const dataUrl = `data:${mime};base64,${content}`

  return (
    <div className={styles.imageViewer}>
      <div className={styles.imageToolbar}>
        <button onClick={() => setZoom(z => Math.max(0.25, z - 0.25))}>-</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(z => Math.min(4, z + 0.25))}>+</button>
        <button onClick={() => setZoom(1)}>Reset</button>
      </div>
      <div className={styles.imageContainer}>
        <img
          src={dataUrl}
          alt={fileName}
          style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
          className={styles.imageContent}
        />
      </div>
    </div>
  )
}

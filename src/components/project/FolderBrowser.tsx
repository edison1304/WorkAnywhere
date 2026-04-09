import { useState, useEffect, useCallback } from 'react'
import type { DirEntry } from '../../../shared/types'
import styles from './FolderBrowser.module.css'

interface Props {
  onSelect: (path: string) => void
  onCancel: () => void
}

export function FolderBrowser({ onSelect, onCancel }: Props) {
  const [currentPath, setCurrentPath] = useState('')
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [newFolderName, setNewFolderName] = useState('')
  const [showNewFolder, setShowNewFolder] = useState(false)

  const loadDir = useCallback(async (path: string) => {
    if (!window.api) return
    setLoading(true)
    setError(undefined)
    const result = await window.api.sshListDir(path)
    if (result.success && result.entries) {
      setEntries(result.entries)
      setCurrentPath(result.currentPath || path)
    } else {
      setError(result.error || 'Failed to list directory')
    }
    setLoading(false)
  }, [])

  // Initial load: home directory
  useEffect(() => {
    if (!window.api) return
    window.api.sshHome().then(result => {
      if (result.success && result.home) {
        loadDir(result.home)
      }
    })
  }, [loadDir])

  const goUp = () => {
    const parent = currentPath.replace(/\/[^/]+\/?$/, '') || '/'
    loadDir(parent)
  }

  const enterDir = (entry: DirEntry) => {
    if (entry.isDir) loadDir(entry.path)
  }

  const createFolder = async () => {
    if (!window.api || !newFolderName.trim()) return
    const newPath = currentPath.replace(/\/$/, '') + '/' + newFolderName.trim()
    const result = await window.api.sshMkdir(newPath)
    if (result.success) {
      setNewFolderName('')
      setShowNewFolder(false)
      loadDir(currentPath)
    }
  }

  return (
    <div className={styles.browser}>
      <div className={styles.header}>
        <span className={styles.title}>Select Workspace Folder</span>
      </div>

      {/* Path bar */}
      <div className={styles.pathBar}>
        <button className={styles.pathBtn} onClick={goUp} title="Go up">↑</button>
        <input
          className={styles.pathInput}
          value={currentPath}
          onChange={e => setCurrentPath(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && loadDir(currentPath)}
        />
        <button className={styles.pathBtn} onClick={() => loadDir(currentPath)} title="Go">→</button>
      </div>

      {/* File list */}
      <div className={styles.fileList}>
        {loading ? (
          <div className={styles.loading}>Loading...</div>
        ) : error ? (
          <div className={styles.error}>{error}</div>
        ) : (
          <>
            {entries.filter(e => e.isDir && !e.name.startsWith('.')).map(entry => (
              <button
                key={entry.path}
                className={styles.fileItem}
                onDoubleClick={() => enterDir(entry)}
                onClick={() => enterDir(entry)}
              >
                <span className={styles.fileIcon}>📁</span>
                <span className={styles.fileName}>{entry.name}</span>
              </button>
            ))}
            {entries.filter(e => e.isDir).length === 0 && (
              <div className={styles.emptyDir}>Empty directory</div>
            )}
          </>
        )}
      </div>

      {/* New folder */}
      {showNewFolder && (
        <div className={styles.newFolderRow}>
          <input
            className={styles.newFolderInput}
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            placeholder="New folder name"
            onKeyDown={e => e.key === 'Enter' && createFolder()}
            autoFocus
          />
          <button className={styles.newFolderBtn} onClick={createFolder}>Create</button>
          <button className={styles.newFolderCancel} onClick={() => setShowNewFolder(false)}>✕</button>
        </div>
      )}

      {/* Actions */}
      <div className={styles.actions}>
        <button className={styles.newBtn} onClick={() => setShowNewFolder(true)}>
          + New Folder
        </button>
        <div style={{ flex: 1 }} />
        <button className={styles.cancelBtn} onClick={onCancel}>Cancel</button>
        <button
          className={styles.selectBtn}
          onClick={() => onSelect(currentPath)}
        >
          Select: {currentPath.split('/').pop() || '/'}
        </button>
      </div>
    </div>
  )
}

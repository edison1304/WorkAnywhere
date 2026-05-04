import { useState, useEffect } from 'react'
import styles from './CompactDialog.module.css'

interface Props {
  isOpen: boolean
  taskName: string
  onClose: () => void
  /** Run claude compact then mark complete. focus is optional. */
  onCompactAndComplete: (focusInstructions: string) => Promise<void>
  /** Skip compact, just mark complete. */
  onSkipAndComplete: () => Promise<void>
}

export function CompactDialog({ isOpen, taskName, onClose, onCompactAndComplete, onSkipAndComplete }: Props) {
  const [focus, setFocus] = useState('')
  const [busy, setBusy] = useState<'compact' | 'skip' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setFocus('')
      setBusy(null)
      setError(null)
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleCompact = async () => {
    setBusy('compact')
    setError(null)
    try {
      await onCompactAndComplete(focus.trim())
    } catch (err) {
      setError(String(err))
      setBusy(null)
    }
  }

  const handleSkip = async () => {
    setBusy('skip')
    setError(null)
    try {
      await onSkipAndComplete()
    } catch (err) {
      setError(String(err))
      setBusy(null)
    }
  }

  return (
    <div className={styles.overlay} onClick={busy ? undefined : onClose}>
      <div className={styles.dialog} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h3>
            완료
            <span className={styles.taskName}>· {taskName}</span>
          </h3>
          <button className={styles.closeBtn} onClick={onClose} disabled={!!busy}>✕</button>
        </div>

        <div className={styles.body}>
          <div className={styles.hint}>
            이 task의 대화 로그를 Claude가 <strong>완료 / 우회 / 에러</strong> 3-bucket으로 정리합니다.
            정리된 결과가 Timeline에 표시됩니다.
          </div>

          <label className={styles.label}>포커스 (선택) — 무엇을 강조해 정리할지</label>
          <textarea
            className={styles.textarea}
            placeholder="예: 버그 수정 위주로 / 결정 위주로 / 인증 관련만"
            value={focus}
            onChange={e => setFocus(e.target.value)}
            disabled={!!busy}
            autoFocus
          />

          {error && <div className={styles.error}>{error}</div>}
        </div>

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onClose} disabled={!!busy}>
            취소
          </button>
          <button className={styles.skipBtn} onClick={handleSkip} disabled={!!busy}>
            {busy === 'skip' ? '...' : '압축 없이 완료'}
          </button>
          <button className={styles.compactBtn} onClick={handleCompact} disabled={!!busy}>
            {busy === 'compact' ? '압축 중...' : '압축하고 완료'}
          </button>
        </div>
      </div>
    </div>
  )
}

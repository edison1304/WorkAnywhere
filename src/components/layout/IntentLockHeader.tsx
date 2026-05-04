import type { Task } from '../../../shared/types'
import styles from './IntentLockHeader.module.css'

interface Props {
  task: Task
}

/**
 * Intent Lock — work_anywhere_context_summary_ui.md §10.
 *
 * Three fixed cells:
 *   1) 본목적 — task.purpose
 *   2) 건드리면 안 되는 것 — task.intentLock?.mustNotTouch[]
 *   3) 성공 기준 — task.intentLock?.successCriteria
 *
 * Renders only when at least the purpose is set, since an empty band
 * adds visual noise without information. Optional cells render a muted
 * placeholder so the user notices what's missing.
 */
export function IntentLockHeader({ task }: Props) {
  const purpose = task.purpose?.trim()
  const mustNot = task.intentLock?.mustNotTouch?.filter(s => s.trim().length > 0) ?? []
  const success = task.intentLock?.successCriteria?.trim()

  if (!purpose && mustNot.length === 0 && !success) return null

  return (
    <div className={styles.band} data-testid="intent-lock-header">
      <div className={`${styles.cell} ${styles.cellPurpose}`}>
        <span className={styles.label}>
          <span className={styles.dot} data-tone="purpose" />
          본목적
        </span>
        {purpose
          ? <span className={styles.value}>{purpose}</span>
          : <span className={styles.valueMuted}>(목적 미설정)</span>}
      </div>

      <div className={styles.cell}>
        <span className={styles.label}>
          <span className={styles.dot} data-tone="must-not" />
          건드리면 안 되는 것
        </span>
        {mustNot.length > 0 ? (
          <div className={styles.chipRow}>
            {mustNot.map((item, i) => (
              <span key={i} className={styles.chip}>{item}</span>
            ))}
          </div>
        ) : (
          <span className={styles.valueMuted}>(제약 미설정)</span>
        )}
      </div>

      <div className={styles.cell}>
        <span className={styles.label}>
          <span className={styles.dot} data-tone="success" />
          성공 기준
        </span>
        {success
          ? <span className={styles.value}>{success}</span>
          : <span className={styles.valueMuted}>(성공 기준 미설정)</span>}
      </div>
    </div>
  )
}

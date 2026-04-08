import type { Job } from '../../../shared/types'
import styles from './MainPanel.module.css'

interface Props {
  activeJob: Job | null
}

export function MainPanel({ activeJob }: Props) {
  if (!activeJob) {
    return (
      <div className={styles.panel}>
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>W</div>
          <h2 className={styles.emptyTitle}>Workanywhere</h2>
          <p className={styles.emptyText}>
            Select a job from the sidebar, or create a new one to get started.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.panel}>
      {/* Job header */}
      <div className={styles.jobHeader}>
        <div className={styles.jobHeaderLeft}>
          <h2 className={styles.jobTitle}>{activeJob.name}</h2>
          <span className={styles.jobPrompt}>{activeJob.prompt}</span>
        </div>
        <div className={styles.jobActions}>
          <button className={styles.actionBtn} title="Send follow-up">
            Send
          </button>
          <button className={styles.actionBtn} data-variant="danger" title="Stop job">
            Stop
          </button>
        </div>
      </div>

      {/* Terminal area (placeholder) */}
      <div className={styles.terminalArea}>
        <div className={styles.terminalHeader}>
          <span className={styles.terminalTab}>Terminal</span>
          <span className={styles.terminalTab}>Artifacts</span>
        </div>
        <div className={styles.terminalBody}>
          <div className={styles.terminalPlaceholder}>
            <span style={{ color: 'var(--accent)' }}>claude</span>
            <span style={{ color: 'var(--text-muted)' }}> &gt; </span>
            <span style={{ color: 'var(--text-secondary)' }}>{activeJob.prompt}</span>
            <div style={{ marginTop: 16 }}>
              <span style={{ color: 'var(--success)' }}>●</span>
              <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: 13 }}>
                {activeJob.status === 'running' ? 'Working...' :
                 activeJob.status === 'waiting' ? 'Waiting for input...' :
                 activeJob.status === 'completed' ? 'Completed.' :
                 activeJob.status === 'failed' ? 'Failed.' : activeJob.status}
              </span>
            </div>
            {activeJob.status === 'running' && (
              <div className={styles.cursor}>_</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

import type { InsightRow } from './insights'
import styles from './InsightPanel.module.css'

interface Props {
  title: string
  /** Optional subtitle line (e.g., phase name for a task panel). */
  subtitle?: string
  rows: InsightRow[]
}

export function InsightPanel({ title, subtitle, rows }: Props) {
  return (
    <div className={styles.body}>
      <div className={styles.title}>{title}</div>
      {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
      <div className={styles.rows}>
        {rows.map((row, i) => (
          <div key={i} className={`${styles.row} ${styles[`tone_${row.tone}`]}`}>
            <span className={styles.dot} />
            <span className={styles.label}>{row.label}</span>
            <span className={styles.value} title={row.value}>{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

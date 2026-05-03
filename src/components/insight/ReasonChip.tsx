import type { ReasonChip as ReasonChipData } from './reasons'
import styles from './ReasonChip.module.css'

interface Props {
  /** Pass null to render nothing. Component is a no-op when reason is silent. */
  reason: ReasonChipData | null
  /** Optional inline style override (rarely needed). */
  small?: boolean
}

export function ReasonChip({ reason, small }: Props) {
  if (!reason) return null
  return (
    <span
      className={`${styles.chip} ${styles[`tone_${reason.tone}`]} ${small ? styles.small : ''}`}
      title={reason.text}
    >
      {reason.text}
    </span>
  )
}

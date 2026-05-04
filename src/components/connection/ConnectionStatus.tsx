import { useEffect, useState } from 'react'
import styles from './ConnectionStatus.module.css'

export type ConnState = 'connected' | 'reconnecting' | 'lost' | 'failed' | 'disconnected'

interface Props {
  state: ConnState
  /** Display label — usually host or "Local". Hidden on lost/failed. */
  hostLabel?: string
  /** ms timestamp of last successful heartbeat ping. Drives "N초 전" text. */
  lastPing?: number | null
  /** Optional retry attempt info while reconnecting. */
  attempt?: number
  maxRetries?: number
  /** Click handler — open connect dialog or trigger reconnect. */
  onClick?: () => void
}

/** Bottom-right fixed connection indicator. Shape varies by state:
 *  - connected:    quiet dot + host + "Xs ago"
 *  - reconnecting: pulsing amber + "재연결 중 1/3"
 *  - lost:         red + "연결 끊김"
 *  - failed:       red + "재연결 실패 — 클릭으로 재시도"
 *  - disconnected: gray + "Disconnected"
 */
export function ConnectionStatus({ state, hostLabel, lastPing, attempt, maxRetries, onClick }: Props) {
  // Tick every 5s so "N초 전" stays fresh without spamming re-renders.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (state !== 'connected') return
    const id = setInterval(() => setNow(Date.now()), 5_000)
    return () => clearInterval(id)
  }, [state])

  const ago = lastPing ? Math.max(0, Math.floor((now - lastPing) / 1000)) : null

  let label = ''
  let title = ''
  switch (state) {
    case 'connected':
      label = hostLabel || 'Connected'
      title = ago !== null ? `Last heartbeat ${ago}s ago` : 'Connected'
      break
    case 'reconnecting':
      label = `재연결 중${attempt && maxRetries ? ` ${attempt}/${maxRetries}` : ''}`
      title = '연결 복구 시도 중'
      break
    case 'lost':
      label = '연결 끊김'
      title = '재연결 시도 중...'
      break
    case 'failed':
      label = '재연결 실패'
      title = '클릭하여 다시 연결'
      break
    case 'disconnected':
      label = 'Disconnected'
      title = '연결되지 않음'
      break
  }

  return (
    <div
      className={`${styles.indicator} ${onClick ? styles.clickable : ''}`}
      data-state={state}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      title={title}
    >
      <span className={styles.dot} />
      <span className={styles.label}>{label}</span>
      {state === 'connected' && ago !== null && (
        <span className={styles.ago}>{ago < 60 ? `${ago}s` : `${Math.floor(ago / 60)}m`}</span>
      )}
    </div>
  )
}

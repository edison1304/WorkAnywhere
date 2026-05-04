import { useState } from 'react'
import type { Task } from '../../../shared/types'
import styles from './EventCard.module.css'

interface Props {
  task: Task
  /** Triggers task:summarize IPC. Used by Generate / Refresh buttons. */
  onSummarize?: (taskId: string) => void
  /** Fills the ChatInput with the given text and switches to the Chat tab.
   *  Defined in MainPanel; lets the user review before sending. */
  onFillChat?: (text: string) => void
}

/**
 * EventCard — work_anywhere_context_summary_ui.md §12.
 *
 * Renders the seven event-shaped fields of TaskSummary as a
 * "label + value" repeating structure (§14.3 — text < structure).
 *
 * Three states:
 *   1) No summary yet            → "Generate Summary" CTA
 *   2) Summary with event fields → render non-null sections
 *   3) Summary, all events null  → "no judgment arc this session" hint
 *                                   + fall back to legacy progress for context
 *
 * residualRisk and humanNeeded use warning tone (§14.5 — emphasize
 * judgment points: 임시방편, 위험, 사람 개입 필요).
 */
export function EventCard({ task, onSummarize, onFillChat }: Props) {
  const summary = task.summary
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')

  // ─── State 1: no summary at all ───
  if (!summary) {
    return (
      <div className={styles.card}>
        <div className={styles.empty}>
          <p className={styles.emptyText}>
            아직 이 태스크의 요약이 생성되지 않았습니다.
          </p>
          <p className={styles.emptyHint}>
            요약을 생성하면 사건 단위로 정리된 맥락(문제 → 원인 → 대응 → 이유 → 위험 → 다음 지시)을 확인할 수 있습니다.
          </p>
          {onSummarize && (
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => onSummarize(task.id)}
            >
              요약 생성
            </button>
          )}
        </div>
      </div>
    )
  }

  const eventFields = [
    summary.problem,
    summary.cause,
    summary.response,
    summary.reason,
    summary.residualRisk,
    summary.humanNeeded,
    summary.nextPrompt,
  ]
  const hasAnyEvent = eventFields.some(v => v && v.trim().length > 0)

  const updatedAgo = (() => {
    const diff = Date.now() - new Date(summary.updatedAt).getTime()
    const m = Math.floor(diff / 60000)
    if (m < 1) return '방금 전'
    if (m < 60) return `${m}분 전`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}시간 전`
    return `${Math.floor(h / 24)}일 전`
  })()

  const copyNextPrompt = async () => {
    if (!summary.nextPrompt) return
    try {
      await navigator.clipboard.writeText(summary.nextPrompt)
      setCopyState('copied')
      setTimeout(() => setCopyState('idle'), 1500)
    } catch { /* clipboard blocked — silent */ }
  }

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div className={styles.headerMeta}>
          <span className={styles.metaLabel}>요약 갱신</span>
          <span className={styles.metaValue}>{updatedAgo}</span>
        </div>
        {onSummarize && (
          <button
            type="button"
            className={styles.refreshBtn}
            onClick={() => onSummarize(task.id)}
            title="현재 로그 기준으로 요약 다시 생성"
          >
            ↻ 다시 요약
          </button>
        )}
      </div>

      {/* ─── State 3: summary exists but no event arc detected ─── */}
      {!hasAnyEvent && (
        <div className={styles.noArc}>
          <p>이번 세션은 사건이라 부를 만한 판단 흐름이 감지되지 않았습니다.</p>
          {summary.progress && (
            <p className={styles.noArcProgress}>{summary.progress}</p>
          )}
        </div>
      )}

      {/* ─── State 2: render present event sections ─── */}
      {hasAnyEvent && (
        <div className={styles.sections}>
          <Section label="문제"           tone="neutral"   value={summary.problem} />
          <Section label="원인 판단"      tone="neutral"   value={summary.cause} />
          <Section label="대응"           tone="neutral"   value={summary.response} />
          <Section label="이유"           tone="neutral"   value={summary.reason} />
          <Section label="남은 위험"      tone="warning"   value={summary.residualRisk} />
          <Section label="사람 개입 필요" tone="attention" value={summary.humanNeeded} />

          {summary.nextPrompt && (
            <div className={styles.nextPromptBlock}>
              <div className={styles.nextPromptHeader}>
                <span className={styles.nextPromptLabel}>다음 지시</span>
                <div className={styles.nextPromptActions}>
                  {onFillChat && (
                    <button
                      type="button"
                      className={styles.fillBtn}
                      onClick={() => onFillChat(summary.nextPrompt!)}
                      title="이 프롬프트를 채팅 입력칸에 채우고 검토 후 전송"
                    >
                      채팅에 채우기
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.copyBtn}
                    onClick={copyNextPrompt}
                    data-state={copyState}
                  >
                    {copyState === 'copied' ? '복사됨' : '복사'}
                  </button>
                </div>
              </div>
              <pre className={styles.nextPromptBody}>{summary.nextPrompt}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Section helper ─────────────────────────────────────────────────
function Section({
  label,
  tone,
  value,
}: {
  label: string
  tone: 'neutral' | 'warning' | 'attention'
  value: string | undefined
}) {
  if (!value || !value.trim()) return null
  return (
    <div className={styles.section} data-tone={tone}>
      <span className={styles.sectionLabel}>{label}</span>
      <p className={styles.sectionValue}>{value}</p>
    </div>
  )
}

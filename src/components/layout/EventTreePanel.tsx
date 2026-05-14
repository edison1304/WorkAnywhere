import { useMemo } from 'react'
import type { Task } from '../../../shared/types'
import styles from './EventTreePanel.module.css'

/**
 * EventTreePanel — work_anywhere_context_summary_ui.md §11.
 *
 * "사건 트리" 의 v1 구현. spec 의 "노드별 상태 한눈에 / 시간축 아닌 사건축"
 * 부분을 만족하되, 깊이 / 부모-자식 관계는 데이터 모델 확장이 필요해
 * v2 로 미룬다 (현재는 flat list).
 *
 * 데이터 소스 (재활용):
 *   - task.compacted.completed[]  → resolved 노드
 *   - task.compacted.detours[]    → workaround 노드
 *   - task.compacted.errors[]     → blocked / resolved 노드
 *   - task.summary (event-shaped) → live 노드 (현재 사건)
 *
 * 두 위치에서 같은 컴포넌트를 재사용한다:
 *   - variant='compact'  : Context 탭 안 EventCard 위. 가로 chip 흐름.
 *   - variant='detailed' : 별도 'tree' 탭. 세로 list, 노드별 detail 인라인.
 */

type EventNodeStatus = 'resolved' | 'workaround' | 'blocked' | 'live'

interface EventNode {
  id: string
  title: string
  status: EventNodeStatus
  detail?: string
  timestamp?: string
  source: 'completed' | 'detour' | 'error' | 'live-summary'
}

// ─── Detour keyword detection (mirrors timelineEvents.ts) ──────────
const DETOUR_KEYWORDS = [
  'skip', 'skipped', 'defer', 'deferred', 'bypass', 'bypassed',
  'rollback', 'rolled back', 'reverted', 'instead of', 'workaround',
  '우회', '건너뛰', '보류', '대신', '미뤄', '되돌',
]
function isDetour(text: string): boolean {
  const lower = text.toLowerCase()
  return DETOUR_KEYWORDS.some(k => lower.includes(k))
}

function extractEventNodes(task: Task): EventNode[] {
  const nodes: EventNode[] = []
  const c = task.compacted
  if (c) {
    for (const item of c.completed) {
      nodes.push({
        id: item.id,
        title: item.title,
        status: 'resolved',
        detail: item.detail,
        timestamp: item.timestamp,
        source: 'completed',
      })
    }
    for (const item of c.detours) {
      nodes.push({
        id: item.id,
        title: item.title,
        status: 'workaround',
        detail: item.reason,
        timestamp: item.timestamp,
        source: 'detour',
      })
    }
    for (const item of c.errors) {
      // "미해결" sentinel from task:compact prompt → still blocked.
      const fix = (item.fix ?? '').trim()
      const isResolved = fix.length > 0 && fix !== '미해결'
      nodes.push({
        id: item.id,
        title: item.title,
        status: isResolved ? 'resolved' : 'blocked',
        detail: isResolved
          ? `원인: ${item.cause}\n해결: ${item.fix}`
          : `원인: ${item.cause}\n상태: 미해결`,
        timestamp: item.timestamp,
        source: 'error',
      })
    }
  } else {
    // ─── Fallback: derive nodes from plan.judgmentLog + error logs ───
    // Lets the tree fill in while task:compact is still running (or hasn't
    // been triggered yet). Once compacted lands these get replaced by the
    // curated 3-bucket nodes.
    for (const j of task.plan?.judgmentLog ?? []) {
      const drift = isDetour(`${j.decision} ${j.reason}`)
      nodes.push({
        id: `${task.id}-j-${j.timestamp}-${j.decision.slice(0, 24)}`,
        title: j.decision,
        status: drift ? 'workaround' : 'resolved',
        detail: j.reason,
        timestamp: j.timestamp,
        source: drift ? 'detour' : 'completed',
      })
    }
    // Collapse duplicate errors into one node per unique message.
    const errSeen = new Map<string, { ts: string; count: number }>()
    for (const l of task.logs) {
      if (l.type !== 'error') continue
      const key = l.content.slice(0, 80)
      const prev = errSeen.get(key)
      if (prev) prev.count++
      else errSeen.set(key, { ts: l.timestamp, count: 1 })
    }
    for (const [msg, info] of errSeen) {
      nodes.push({
        id: `${task.id}-err-${info.ts}`,
        title: msg,
        status: 'blocked',
        detail: info.count > 1 ? `${info.count}회 발생 — 미해결` : '미해결',
        timestamp: info.ts,
        source: 'error',
      })
    }
  }
  // Live event = the currently-active arc captured by task.summary.
  // Only emit when the summary actually has event-shaped content; the legacy
  // checklist-only summary doesn't represent an event arc.
  const s = task.summary
  if (s && (s.problem || s.humanNeeded || s.residualRisk)) {
    nodes.push({
      id: `${task.id}-live`,
      title: s.problem || s.humanNeeded || s.residualRisk || '현재 사건',
      status: 'live',
      detail: [s.cause && `원인: ${s.cause}`, s.response && `대응: ${s.response}`, s.reason && `이유: ${s.reason}`]
        .filter(Boolean)
        .join('\n') || undefined,
      timestamp: s.updatedAt,
      source: 'live-summary',
    })
  }
  // Sort by timestamp ascending; nodes without timestamp keep insertion order
  // and slot after timestamped ones.
  nodes.sort((a, b) => {
    if (a.timestamp && b.timestamp) return a.timestamp.localeCompare(b.timestamp)
    if (a.timestamp) return -1
    if (b.timestamp) return 1
    return 0
  })
  return nodes
}

interface Props {
  task: Task
  variant: 'compact' | 'detailed'
  /** Hide the panel's own header — used when embedded in ProjectEventTree
   *  swimlane where each lane already has a task header. */
  hideHeader?: boolean
  /** Hide the legend in detailed mode — same swimlane reasoning. */
  hideLegend?: boolean
  /** Compact placeholder for the "no events yet" state — shows a single
   *  short line instead of the title + hint block. */
  compactEmpty?: boolean
}

export function EventTreePanel({
  task, variant, hideHeader = false, hideLegend = false, compactEmpty = false,
}: Props) {
  const nodes = useMemo(
    () => extractEventNodes(task),
    // task.logs/task.plan feed the fallback path before compacted lands.
    [task.compacted, task.summary, task.logs, task.plan, task.id],
  )

  if (nodes.length === 0) {
    if (compactEmpty) {
      return (
        <div className={styles.empty} data-variant={variant} data-compact-empty="true">
          <p className={styles.emptyHint}>사건 없음 — 에이전트가 작업을 시작하면 자동으로 누적됩니다</p>
        </div>
      )
    }
    return (
      <div className={styles.empty} data-variant={variant}>
        <p className={styles.emptyTitle}>사건 흐름이 아직 없습니다</p>
        <p className={styles.emptyHint}>
          에이전트가 판단·에러를 만들거나 턴이 끝나면 자동으로 채워집니다.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.panel} data-variant={variant}>
      {!hideHeader && (
        <div className={styles.header}>
          <span className={styles.title}>사건 흐름</span>
          <span className={styles.count}>{nodes.length}개</span>
        </div>
      )}
      <ol className={styles.list} data-variant={variant}>
        {nodes.map((node) => (
          <li
            key={node.id}
            className={styles.node}
            data-status={node.status}
            data-variant={variant}
            title={variant === 'compact' && node.detail ? node.detail : undefined}
          >
            <span className={styles.dot} aria-hidden="true" />
            <div className={styles.body}>
              <span className={styles.nodeTitle}>{node.title}</span>
              {variant === 'detailed' && node.detail && (
                <p className={styles.nodeDetail}>{node.detail}</p>
              )}
              {variant === 'detailed' && node.timestamp && (
                <span className={styles.nodeTimestamp}>{formatTimestamp(node.timestamp)}</span>
              )}
            </div>
          </li>
        ))}
      </ol>
      {variant === 'detailed' && !hideLegend && (
        <div className={styles.legend}>
          <LegendItem status="resolved"   label="해결" />
          <LegendItem status="workaround" label="우회/임시방편" />
          <LegendItem status="blocked"    label="막힘" />
          <LegendItem status="live"       label="현재" />
        </div>
      )}
    </div>
  )
}

function LegendItem({ status, label }: { status: EventNodeStatus; label: string }) {
  return (
    <span className={styles.legendItem}>
      <span className={styles.dot} data-status={status} aria-hidden="true" />
      {label}
    </span>
  )
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts)
    if (Number.isNaN(d.getTime())) return ''
    const m = Math.floor((Date.now() - d.getTime()) / 60000)
    if (m < 1) return '방금 전'
    if (m < 60) return `${m}분 전`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}시간 전`
    return `${Math.floor(h / 24)}일 전`
  } catch {
    return ''
  }
}

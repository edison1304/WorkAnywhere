import { useState, useEffect, useMemo } from 'react'
import type { Project, Phase, Task } from '../../../shared/types'
import { StatusDot } from '../job/StatusDot'
import styles from './ProjectEventTree.module.css'

/**
 * ProjectEventTree — 4-mode 관제 뷰.
 *
 *   Attention (default) — 어디서 멈춰 있고 누가 손대야 하나
 *   Pulse              — 지금 얼마나 살아있고 어디가 시끄러운가
 *   Timeline           — 병렬 task들이 시간상 어떻게 겹쳤나
 *   Flow               — task들이 어떻게 분기/의존/이어지나
 *
 * Layer 1 = mode shell + Attention 베이스 (카드 그리드 + phase collapse).
 * 다른 모드는 placeholder. (L2~L5에서 채움)
 */

type TreeMode = 'attention' | 'pulse' | 'timeline' | 'flow'
const MODE_KEY = 'wa.tree.mode'
const DEFAULT_MODE: TreeMode = 'attention'

const MODES: { id: TreeMode; label: string; shortcut: string }[] = [
  { id: 'attention', label: 'Attention', shortcut: 'B' },
  { id: 'pulse',     label: 'Pulse',     shortcut: 'P' },
  { id: 'timeline',  label: 'Timeline',  shortcut: 'T' },
  { id: 'flow',      label: 'Flow',      shortcut: 'F' },
]

interface Props {
  project: Project | null
  phases: Phase[]
  tasks: Task[]
  onSelectTask: (taskId: string) => void
}

export function ProjectEventTree({ project, phases, tasks, onSelectTask }: Props) {
  const [mode, setMode] = useState<TreeMode>(() => {
    if (typeof window === 'undefined') return DEFAULT_MODE
    const v = window.localStorage?.getItem(MODE_KEY)
    if (v === 'attention' || v === 'pulse' || v === 'timeline' || v === 'flow') return v
    return DEFAULT_MODE
  })

  useEffect(() => {
    try { window.localStorage?.setItem(MODE_KEY, mode) } catch { /* ignore */ }
  }, [mode])

  const sections = useMemo<Array<{ phase: Phase | null; tasks: Task[] }>>(() => {
    if (!project) return []
    const projectTasks = tasks.filter(t => t.projectId === project.id)
    const projectPhases = phases
      .filter(p => p.projectId === project.id)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    const grouped: Array<{ phase: Phase | null; tasks: Task[] }> = projectPhases
      .map(phase => ({
        phase: phase as Phase | null,
        tasks: projectTasks
          .filter(t => t.phaseId === phase.id)
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
      }))
      .filter(g => g.tasks.length > 0)
    const orphans = projectTasks.filter(t => !projectPhases.some(p => p.id === t.phaseId))
    if (orphans.length) grouped.push({ phase: null, tasks: orphans })
    return grouped
  }, [project, phases, tasks])

  if (!project) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyTitle}>Project Tree</div>
        <div className={styles.emptyHint}>프로젝트를 선택하면 사건 트리가 표시됩니다.</div>
      </div>
    )
  }

  if (sections.length === 0) {
    return (
      <div className={styles.page}>
        <Header project={project} mode={mode} onChangeMode={setMode} />
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>{project.name} — task 없음</div>
          <div className={styles.emptyHint}>좌측 사이드바에서 task를 추가하세요.</div>
        </div>
      </div>
    )
  }

  const projectTasks = useMemo(
    () => (project ? tasks.filter(t => t.projectId === project.id) : []),
    [project, tasks],
  )

  return (
    <div className={styles.page}>
      <Header project={project} mode={mode} onChangeMode={setMode} />
      <AttentionPinBar
        tasks={projectTasks}
        phases={phases}
        onSelectTask={onSelectTask}
      />
      <div className={styles.body}>
        {mode === 'attention' && (
          <AttentionBoard sections={sections} onSelectTask={onSelectTask} />
        )}
        {mode === 'pulse'    && <PulseMode sections={sections} onSelectTask={onSelectTask} />}
        {mode === 'timeline' && <TimelineMode sections={sections} onSelectTask={onSelectTask} />}
        {mode === 'flow'     && <ModePlaceholder label="Flow"     hint="Layer 5 — forkedFromId + 시퀀스 노드-엣지" />}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function Header({
  project,
  mode,
  onChangeMode,
}: {
  project: Project
  mode: TreeMode
  onChangeMode: (m: TreeMode) => void
}) {
  return (
    <header className={styles.header}>
      <div className={styles.titleRow}>
        <div>
          <div className={styles.title}>Project Tree</div>
          <div className={styles.subtitle}>
            <span className={styles.scopeName}>{project.name}</span>
          </div>
        </div>
        <nav className={styles.modeTabs} aria-label="View mode">
          {MODES.map(m => (
            <button
              key={m.id}
              type="button"
              className={`${styles.modeTab} ${m.id === mode ? styles.modeTabActive : ''}`}
              onClick={() => onChangeMode(m.id)}
              title={`${m.label} mode`}
            >
              {m.label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function AttentionBoard({
  sections,
  onSelectTask,
}: {
  sections: Array<{ phase: Phase | null; tasks: Task[] }>
  onSelectTask: (id: string) => void
}) {
  return (
    <div className={styles.board}>
      {sections.map((sec, idx) => (
        <PhaseSection
          key={sec.phase?.id ?? `orphan-${idx}`}
          phase={sec.phase}
          tasks={sec.tasks}
          onSelectTask={onSelectTask}
        />
      ))}
    </div>
  )
}

function PhaseSection({
  phase,
  tasks,
  onSelectTask,
}: {
  phase: Phase | null
  tasks: Task[]
  onSelectTask: (id: string) => void
}) {
  const attnCount = tasks.filter(isAttentionTask).length
  const completedCount = tasks.filter(t => t.status === 'completed').length
  const total = tasks.length
  const completedPct = total > 0 ? Math.round((completedCount / total) * 100) : 0
  const [collapsed, setCollapsed] = useState(attnCount === 0)

  return (
    <section className={styles.phaseSection} data-collapsed={collapsed ? 'true' : 'false'}>
      <button
        type="button"
        className={styles.phaseHeader}
        onClick={() => setCollapsed(c => !c)}
        aria-expanded={!collapsed}
      >
        <span className={styles.phaseCaret} aria-hidden="true">
          {collapsed ? '▸' : '▾'}
        </span>
        <span className={styles.phaseName}>{phase?.name ?? '(Phase 없음)'}</span>
        <span className={styles.phaseCount}>{total} tasks</span>
        <span className={styles.phaseSpacer} />
        {attnCount > 0 && (
          <span className={styles.phaseAttnBadge}>
            ⌛ {attnCount}
          </span>
        )}
        <span className={styles.phaseBar} aria-label={`${completedCount} of ${total} done`}>
          <span className={styles.phaseBarTrack}>
            <span className={styles.phaseBarFill} style={{ width: `${completedPct}%` }} />
          </span>
          {completedCount}/{total} done
        </span>
      </button>

      {!collapsed && (
        <div className={styles.cardGrid}>
          {tasks.map(task => (
            <TaskCard key={task.id} task={task} onSelectTask={onSelectTask} />
          ))}
        </div>
      )}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  onSelectTask,
}: {
  task: Task
  onSelectTask: (id: string) => void
}) {
  const attn = isAttentionTask(task)
  const hasFork = Boolean(task.forkedFromId)
  const glyph = task.status === 'review' ? '✋' : task.status === 'waiting' ? '⌛' : ''
  const summaryLine = task.summary?.currentStep ?? task.summary?.progress ?? ''
  const dots = useMemo(() => compactedDots(task), [task.compacted])

  return (
    <button
      type="button"
      className={`${styles.card} ${attn ? styles.cardAttn : ''} ${!attn && task.status === 'completed' ? styles.cardMuted : ''}`}
      data-status={task.status}
      onClick={() => onSelectTask(task.id)}
      title={task.name}
    >
      <div className={styles.cardLine1}>
        {!attn && <StatusDot status={task.status} size={7} />}
        <span className={styles.cardName}>{task.name}</span>
        {hasFork && <span className={styles.cardForkChip} title="forked task">↳</span>}
        {attn && <span className={styles.cardGlyph}>{glyph}</span>}
      </div>

      {summaryLine && <div className={styles.cardLine2}>{summaryLine}</div>}

      {dots.length > 0 && (
        <div className={styles.cardLine3}>
          {dots.map((d, i) => (
            <span
              key={i}
              className={`${styles.cardDot} ${i === dots.length - 1 ? styles.cardDotLast : ''}`}
              data-kind={d.kind}
            />
          ))}
          <span className={styles.cardDotLabel}>{dots.length} 이벤트</span>
        </div>
      )}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function AttentionPinBar({
  tasks,
  phases,
  onSelectTask,
}: {
  tasks: Task[]
  phases: Phase[]
  onSelectTask: (id: string) => void
}) {
  const attn = tasks.filter(isAttentionTask)
  if (attn.length === 0) return null

  const sorted = [...attn].sort((a, b) => {
    const aTs = lastActivityTs(a)
    const bTs = lastActivityTs(b)
    return bTs.localeCompare(aTs)
  })

  const MAX = 6
  const visible = sorted.slice(0, MAX)
  const more = sorted.length - visible.length

  return (
    <div className={styles.attnPin} role="region" aria-label="Attention tasks">
      <div className={styles.attnPinHead}>
        <span className={styles.attnPinHeadDot} aria-hidden="true" />
        지금 손이 필요한 곳
        <span className={styles.attnPinHint}>
          — {attn.length} task{attn.length > 1 ? 's' : ''} · 페이즈 무관
        </span>
      </div>
      <div className={styles.attnPinList}>
        {visible.map(task => {
          const phase = phases.find(p => p.id === task.phaseId) ?? null
          const glyph = task.status === 'review' ? '✋' : '⌛'
          const ago = relativeFromNow(lastActivityTs(task))
          return (
            <button
              key={task.id}
              type="button"
              className={styles.attnChip}
              onClick={() => onSelectTask(task.id)}
              title={task.name}
            >
              <span className={styles.attnChipGlyph}>{glyph}</span>
              <span className={styles.attnChipName}>{task.name}</span>
              <span className={styles.attnChipMeta}>
                {task.status} · {phase?.name ?? '—'}{ago ? ` · ${ago}` : ''}
              </span>
            </button>
          )
        })}
        {more > 0 && (
          <div className={styles.attnChipMore} title={`${more}개 더`}>+{more}</div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode D — Timeline (Gantt-ish horizontal axis)

type Zoom = 'day' | 'week' | 'month'
const ZOOM_KEY = 'wa.tree.timeline.zoom'
const ZOOM_MS: Record<Zoom, number> = {
  day:   24 * 3600 * 1000,
  week:  7 * 24 * 3600 * 1000,
  month: 30 * 24 * 3600 * 1000,
}
const ZOOM_LABELS: Record<Zoom, string> = { day: '1d', week: '1w', month: '1mo' }

function TimelineMode({
  sections,
  onSelectTask,
}: {
  sections: Array<{ phase: Phase | null; tasks: Task[] }>
  onSelectTask: (id: string) => void
}) {
  const [zoom, setZoom] = useState<Zoom>(() => {
    if (typeof window === 'undefined') return 'week'
    const v = window.localStorage?.getItem(ZOOM_KEY)
    if (v === 'day' || v === 'week' || v === 'month') return v
    return 'week'
  })
  useEffect(() => {
    try { window.localStorage?.setItem(ZOOM_KEY, zoom) } catch { /* ignore */ }
  }, [zoom])

  // Re-derive range each render — Date.now() is OK; user is unlikely to leave
  // this tab open for hours where the "now" drift becomes visible.
  const range = useMemo(() => {
    const end = Date.now()
    return { start: end - ZOOM_MS[zoom], end }
  }, [zoom])

  const ticks = useMemo(() => axisTicks(zoom), [zoom])

  return (
    <div className={styles.timeline}>
      <div className={styles.zoomRow}>
        <span className={styles.zoomLabel}>Zoom</span>
        {(['day', 'week', 'month'] as Zoom[]).map(z => (
          <button
            key={z}
            type="button"
            className={`${styles.zoomBtn} ${z === zoom ? styles.zoomBtnActive : ''}`}
            onClick={() => setZoom(z)}
          >
            {ZOOM_LABELS[z]}
          </button>
        ))}
      </div>

      <div className={styles.timelineAxis} role="presentation">
        <div className={styles.timelineAxisHead} />
        <div className={styles.timelineAxisTicks}>
          {ticks.map((t, i) => (
            <span
              key={i}
              className={styles.timelineTick}
              style={{ left: `${t.left}%` }}
            >
              {t.label}
            </span>
          ))}
        </div>
      </div>

      <div className={styles.timelineBody}>
        {sections.map((sec, idx) => (
          <section key={sec.phase?.id ?? `orphan-${idx}`} className={styles.timelinePhase}>
            <div className={styles.timelinePhaseHeader}>
              <span className={styles.phaseName}>{sec.phase?.name ?? '(Phase 없음)'}</span>
              <span className={styles.phaseCount}>{sec.tasks.length} tasks</span>
            </div>
            <div className={styles.timelineLanes}>
              {sec.tasks.map(task => (
                <TimelineLane
                  key={task.id}
                  task={task}
                  range={range}
                  onSelectTask={onSelectTask}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function TimelineLane({
  task,
  range,
  onSelectTask,
}: {
  task: Task
  range: { start: number; end: number }
  onSelectTask: (id: string) => void
}) {
  const span = taskSpan(task, range)
  const dots = logTimestamps(task, range)
  const empty = span === null

  return (
    <div className={styles.timelineLane} data-status={task.status}>
      <button
        type="button"
        className={styles.timelineLaneHead}
        onClick={() => onSelectTask(task.id)}
        title={task.name}
      >
        <StatusDot status={task.status} size={7} />
        <span className={styles.timelineLaneName}>{task.name}</span>
      </button>
      <div className={styles.timelineTrack}>
        {empty ? (
          <span className={styles.timelineEmpty}>시작 전</span>
        ) : (
          <span
            className={styles.timelineBar}
            data-status={task.status}
            style={{ left: `${span.left}%`, width: `${Math.max(span.width, 0.4)}%` }}
            aria-label={`${task.name} duration`}
          />
        )}
        {dots.map((leftPct, i) => (
          <span
            key={i}
            className={styles.timelineEvt}
            style={{ left: `${leftPct}%` }}
          />
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode A — Pulse (Activity heatmap)

const PULSE_ZOOM_KEY = 'wa.tree.pulse.zoom'
const LIVE_WINDOW_MS = 60_000 // <1m = "live" head dot

function PulseMode({
  sections,
  onSelectTask,
}: {
  sections: Array<{ phase: Phase | null; tasks: Task[] }>
  onSelectTask: (id: string) => void
}) {
  const [zoom, setZoom] = useState<Zoom>(() => {
    if (typeof window === 'undefined') return 'day'
    const v = window.localStorage?.getItem(PULSE_ZOOM_KEY)
    if (v === 'day' || v === 'week' || v === 'month') return v
    return 'day'
  })
  useEffect(() => {
    try { window.localStorage?.setItem(PULSE_ZOOM_KEY, zoom) } catch { /* ignore */ }
  }, [zoom])

  const range = useMemo(() => {
    const end = Date.now()
    return { start: end - ZOOM_MS[zoom], end }
  }, [zoom])

  const ticks = useMemo(() => axisTicks(zoom), [zoom])
  const bucketCount = ticks.length - 1

  return (
    <div className={styles.pulse}>
      <div className={styles.zoomRow}>
        <span className={styles.zoomLabel}>Zoom</span>
        {(['day', 'week', 'month'] as Zoom[]).map(z => (
          <button
            key={z}
            type="button"
            className={`${styles.zoomBtn} ${z === zoom ? styles.zoomBtnActive : ''}`}
            onClick={() => setZoom(z)}
          >
            {ZOOM_LABELS[z]}
          </button>
        ))}
      </div>

      <div className={styles.timelineAxis} role="presentation">
        <div className={styles.timelineAxisHead} />
        <div className={styles.timelineAxisTicks}>
          {ticks.map((t, i) => (
            <span
              key={i}
              className={styles.timelineTick}
              style={{ left: `${t.left}%` }}
            >
              {t.label}
            </span>
          ))}
        </div>
      </div>

      <div className={styles.timelineBody}>
        {sections.map((sec, idx) => (
          <section key={sec.phase?.id ?? `orphan-${idx}`} className={styles.timelinePhase}>
            <div className={styles.timelinePhaseHeader}>
              <span className={styles.phaseName}>{sec.phase?.name ?? '(Phase 없음)'}</span>
              <span className={styles.phaseCount}>{sec.tasks.length} tasks</span>
            </div>
            <div className={styles.timelineLanes}>
              {sec.tasks.map(task => (
                <PulseLane
                  key={task.id}
                  task={task}
                  range={range}
                  bucketCount={bucketCount}
                  onSelectTask={onSelectTask}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function PulseLane({
  task,
  range,
  bucketCount,
  onSelectTask,
}: {
  task: Task
  range: { start: number; end: number }
  bucketCount: number
  onSelectTask: (id: string) => void
}) {
  const buckets = logBuckets(task, range, bucketCount)
  const lastTs = lastActivityTs(task)
  const lastMs = lastTs ? new Date(lastTs).getTime() : NaN
  const live = Number.isFinite(lastMs) && (Date.now() - lastMs) < LIVE_WINDOW_MS

  return (
    <div className={styles.timelineLane} data-status={task.status}>
      <button
        type="button"
        className={styles.timelineLaneHead}
        onClick={() => onSelectTask(task.id)}
        title={task.name}
      >
        <StatusDot status={task.status} size={7} />
        <span className={styles.timelineLaneName}>{task.name}</span>
      </button>
      <div className={`${styles.pulseTrack}`}>
        {buckets.map((count, i) => (
          <span
            key={i}
            className={styles.pulseBar}
            data-level={pulseLevel(count)}
            title={`${count} event${count === 1 ? '' : 's'}`}
          />
        ))}
        <span
          className={styles.pulseHead}
          data-status={task.status}
          data-live={live ? 'true' : 'false'}
          aria-label={live ? 'live activity' : 'last activity'}
        />
      </div>
    </div>
  )
}

function ModePlaceholder({ label, hint }: { label: string; hint: string }) {
  return (
    <div className={styles.placeholder}>
      <div className={styles.placeholderTitle}>{label} mode</div>
      <div className={styles.placeholderHint}>{hint}</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers

function isAttentionTask(t: Task): boolean {
  return t.status === 'waiting' || t.status === 'review'
}

type DotKind = 'completed' | 'detour' | 'error'

function lastActivityTs(task: Task): string {
  const last = task.logs[task.logs.length - 1]
  return last?.timestamp ?? task.updatedAt ?? task.createdAt ?? ''
}

function relativeFromNow(iso: string): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  const s = Math.floor(ms / 1000)
  if (s < 45) return 'now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  return `${Math.floor(d / 7)}w`
}

function taskSpan(
  task: Task,
  range: { start: number; end: number },
): { left: number; width: number } | null {
  const startIso = task.logs[0]?.timestamp ?? task.createdAt
  if (!startIso) return null
  const startMs = new Date(startIso).getTime()
  if (!Number.isFinite(startMs)) return null

  // Running / waiting / review tasks extend to "now". Otherwise to completedAt.
  const endMs = task.completedAt
    ? new Date(task.completedAt).getTime()
    : Date.now()

  // Clip to range. Tasks fully outside the window return null.
  const visStart = Math.max(startMs, range.start)
  const visEnd   = Math.min(endMs, range.end)
  if (visEnd <= visStart) return null

  const total = range.end - range.start
  return {
    left:  ((visStart - range.start) / total) * 100,
    width: ((visEnd - visStart)      / total) * 100,
  }
}

function logTimestamps(
  task: Task,
  range: { start: number; end: number },
): number[] {
  const total = range.end - range.start
  const out: number[] = []
  for (const log of task.logs) {
    if (!log.timestamp) continue
    const ms = new Date(log.timestamp).getTime()
    if (!Number.isFinite(ms) || ms < range.start || ms > range.end) continue
    out.push(((ms - range.start) / total) * 100)
  }
  return out
}

function axisTicks(zoom: Zoom): Array<{ label: string; left: number }> {
  const count = zoom === 'month' ? 6 : 7
  const totalMs = ZOOM_MS[zoom]
  const ticks: Array<{ label: string; left: number }> = []
  for (let i = 0; i < count; i++) {
    const left = (i / (count - 1)) * 100
    const agoMs = totalMs - (totalMs * i) / (count - 1)
    let label: string
    if (i === count - 1) label = '지금'
    else if (zoom === 'day') label = `-${Math.round(agoMs / 3_600_000)}h`
    else label = `-${Math.round(agoMs / 86_400_000)}d`
    ticks.push({ label, left })
  }
  return ticks
}

function logBuckets(
  task: Task,
  range: { start: number; end: number },
  count: number,
): number[] {
  const total = range.end - range.start
  if (total <= 0 || count <= 0) return []
  const bucketSize = total / count
  const buckets = new Array<number>(count).fill(0)
  for (const log of task.logs) {
    if (!log.timestamp) continue
    const ms = new Date(log.timestamp).getTime()
    if (!Number.isFinite(ms) || ms < range.start || ms > range.end) continue
    const idx = Math.min(Math.floor((ms - range.start) / bucketSize), count - 1)
    buckets[idx]++
  }
  return buckets
}

function pulseLevel(count: number): 'zero' | 'lo' | 'mid' | 'hi' {
  if (count <= 0) return 'zero'
  if (count <= 1) return 'lo'
  if (count <= 3) return 'mid'
  return 'hi'
}

function compactedDots(task: Task): Array<{ kind: DotKind; ts?: string }> {
  if (!task.compacted) return []
  const events: Array<{ kind: DotKind; ts?: string }> = [
    ...task.compacted.completed.map(c => ({ kind: 'completed' as const, ts: c.timestamp })),
    ...task.compacted.detours  .map(d => ({ kind: 'detour'    as const, ts: d.timestamp })),
    ...task.compacted.errors   .map(e => ({ kind: 'error'     as const, ts: e.timestamp })),
  ].sort((a, b) => (a.ts ?? '').localeCompare(b.ts ?? ''))
  return events.slice(-6)
}

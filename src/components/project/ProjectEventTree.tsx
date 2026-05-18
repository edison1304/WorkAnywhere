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
        {mode === 'pulse'    && <ModePlaceholder label="Pulse"    hint="Layer 4 — Activity heatmap, 시간 bucket 가공" />}
        {mode === 'timeline' && <ModePlaceholder label="Timeline" hint="Layer 3 — 공유 horizontal time axis (Gantt-ish)" />}
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

function compactedDots(task: Task): Array<{ kind: DotKind; ts?: string }> {
  if (!task.compacted) return []
  const events: Array<{ kind: DotKind; ts?: string }> = [
    ...task.compacted.completed.map(c => ({ kind: 'completed' as const, ts: c.timestamp })),
    ...task.compacted.detours  .map(d => ({ kind: 'detour'    as const, ts: d.timestamp })),
    ...task.compacted.errors   .map(e => ({ kind: 'error'     as const, ts: e.timestamp })),
  ].sort((a, b) => (a.ts ?? '').localeCompare(b.ts ?? ''))
  return events.slice(-6)
}

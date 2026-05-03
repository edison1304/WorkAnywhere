import type {
  Task,
  Phase,
  InteractionLevel,
  WeightHint,
  ScheduleResult,
  ScheduledTask,
} from '../../../shared/types'

/**
 * SchedulingService — CPU-nice style task ordering for the Schedule page.
 *
 * Philosophy: heavy + autonomous tasks rise to the top (fire-and-forget),
 * interactive tasks sink to the bottom (handle when you have time).
 *
 * Pipeline:
 *   1. Resolve InteractionLevel/WeightHint per task (user override > heuristic)
 *   2. Compute nice score per task
 *   3. Sort ascending by nice
 *   4. Ask LLM where to draw the "above = fire, below = babysit" line
 *      (with a sign-based fallback if LLM is unavailable)
 */

// ─── Heuristic keyword maps ───
// Only loaded once; matched against name + purpose + prompt.
const INTERACTIVE_KEYWORDS = [
  '검토', '확인', '결정', '리뷰', '승인', '컨펌', '판단',
  'review', 'confirm', 'decide', 'approve', 'sign-off', 'sign off',
  'check ', 'verify',
]

const HEAVY_KEYWORDS = [
  '학습', '훈련', '대량', '전체', '스캔', '전처리', '분석',
  'train', 'analyze', 'process', 'build', 'scan', 'crawl',
  'index', 'compile', 'migrate', 'backfill',
]

const LIGHT_KEYWORDS = [
  '간단', '한줄', '소소',
  'tiny', 'quick', 'rename', 'tweak', 'fix typo',
]

function hasAny(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase()
  return needles.some(n => lower.includes(n.toLowerCase()))
}

export function inferInteractionLevel(task: Task): InteractionLevel {
  // Status is the strongest signal — waiting/review means user attention now
  if (task.status === 'waiting' || task.status === 'review') return 'interactive'

  const text = `${task.name} ${task.purpose} ${task.prompt}`
  if (hasAny(text, INTERACTIVE_KEYWORDS)) return 'mixed'
  return 'autonomous'
}

export function inferWeightHint(task: Task): WeightHint {
  const text = `${task.name} ${task.purpose} ${task.prompt}`
  if (hasAny(text, HEAVY_KEYWORDS)) return 'heavy'
  if (hasAny(text, LIGHT_KEYWORDS)) return 'light'

  // Length-based fallback
  const promptLen = task.prompt.length
  if (promptLen > 1000) return 'heavy'
  if (promptLen < 80) return 'light'
  return 'normal'
}

const INTERACTION_SCORE: Record<InteractionLevel, number> = {
  autonomous: 0,
  mixed: 1,
  interactive: 2,
}

const WEIGHT_SCORE: Record<WeightHint, number> = {
  light: 0,
  normal: 1,
  heavy: 2,
}

/**
 * Compute nice value for a task.
 * Lower = run sooner. Negative = "fire and forget" zone, positive = "needs you" zone.
 *
 * Formula:
 *   nice = INTERACTION × 10 - WEIGHT × 5 + STATUS_MOD - BLOCKING × 3
 */
function computeNice(
  task: Task,
  interaction: InteractionLevel,
  weight: WeightHint,
  blockingCount: number,
): number {
  let nice = INTERACTION_SCORE[interaction] * 10 - WEIGHT_SCORE[weight] * 5

  // Status modifier
  switch (task.status) {
    case 'running':  nice -= 100; break  // already going, keep at top for visibility
    case 'queued':   nice -= 1;   break
    case 'failed':   nice += 8;   break  // needs attention, slightly down
    case 'waiting':  nice += 5;   break  // status already pushed via interaction
    case 'review':   nice += 5;   break
    case 'idle':     break
    default:         break
  }

  nice -= blockingCount * 3
  return nice
}

/**
 * Build ordered list. Excludes completed/failed (handled elsewhere).
 * Interactions/weight come from user override if set, else heuristic.
 */
export function buildOrderedSchedule(
  tasks: Task[],
  phases: Phase[],
): ScheduledTask[] {
  // Active phases only — completed phase tasks are noise on the schedule
  const activePhaseIds = new Set(
    phases.filter(p => p.status !== 'completed').map(p => p.id),
  )
  const candidates = tasks.filter(t =>
    activePhaseIds.has(t.phaseId) &&
    t.status !== 'completed' &&
    t.status !== 'failed',
  )

  // Blocking: how many later-phase candidates exist for the same project.
  // Simple proxy for "stuff downstream is waiting on this."
  const phaseOrder = new Map(phases.map(p => [p.id, p.order]))
  const tasksByProject = new Map<string, Task[]>()
  for (const t of candidates) {
    const arr = tasksByProject.get(t.projectId) ?? []
    arr.push(t)
    tasksByProject.set(t.projectId, arr)
  }
  const blockingCount = (t: Task): number => {
    const myOrder = phaseOrder.get(t.phaseId) ?? 0
    return (tasksByProject.get(t.projectId) ?? [])
      .filter(o => (phaseOrder.get(o.phaseId) ?? 0) > myOrder).length
  }

  const scored: ScheduledTask[] = candidates.map(task => {
    const interactionInferred = task.interactionLevel == null
    const weightInferred = task.weightHint == null
    const interaction = task.interactionLevel ?? inferInteractionLevel(task)
    const weight = task.weightHint ?? inferWeightHint(task)
    const nice = computeNice(task, interaction, weight, blockingCount(task))
    return {
      taskId: task.id,
      nice,
      interactionLevel: interaction,
      weightHint: weight,
      inferred: { interaction: interactionInferred, weight: weightInferred },
    }
  })

  scored.sort((a, b) => a.nice - b.nice)
  return scored
}

/**
 * Fallback split index: first task with nice >= 0.
 * Used when LLM unavailable or returns garbage.
 */
function fallbackSplitIndex(ordered: ScheduledTask[]): number {
  const idx = ordered.findIndex(s => s.nice >= 0)
  return idx === -1 ? ordered.length : idx
}

/**
 * Ask Claude where to split the list. Returns null if it fails — caller falls back.
 *
 * runClaude must accept a prompt and return raw stdout.
 */
export async function computeSplitIndexLLM(
  ordered: ScheduledTask[],
  taskById: (id: string) => Task | null,
  runClaude: (prompt: string) => Promise<string>,
): Promise<number | null> {
  if (ordered.length < 2) return ordered.length

  const lines = ordered.map((s, i) => {
    const t = taskById(s.taskId)
    if (!t) return `${i}. (missing task)`
    return `${i}. [${s.interactionLevel}/${s.weightHint}] ${t.name} — purpose: ${t.purpose || '(none)'} — status: ${t.status}`
  }).join('\n')

  const prompt = `You are scheduling tasks for a developer using a CPU-nice analogy:
above the split = fire-and-forget (heavy, autonomous, run while user is busy elsewhere)
below the split = babysit (needs user attention, decisions, review)

Pick ONE split index where the user should mentally switch from "kick these off" to "I need to handle these myself". Index N means tasks 0..N-1 are fire-and-forget and tasks N..end need attention. 0 means everything needs attention; ${ordered.length} means everything is fire-and-forget.

Tasks (already roughly sorted, you only choose the cut):
${lines}

Respond with ONLY a JSON object, no markdown:
{"splitIndex": <integer 0..${ordered.length}>}`

  let raw: string
  try {
    raw = await runClaude(prompt)
  } catch {
    return null
  }
  const match = raw.match(/\{[\s\S]*?\}/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0])
    const idx = Number(parsed.splitIndex)
    if (!Number.isFinite(idx) || idx < 0 || idx > ordered.length) return null
    return Math.round(idx)
  } catch {
    return null
  }
}

// ─── Cache ───
// Key on (projectId, hash of taskId+status+nice). Same hash = reuse splitIndex.
interface CacheEntry {
  hash: string
  result: ScheduleResult
}
const cache = new Map<string, CacheEntry>()

function hashSchedule(projectId: string, ordered: ScheduledTask[]): string {
  return projectId + '|' + ordered.map(s => `${s.taskId}:${s.nice}`).join(',')
}

export async function compute(
  projectId: string,
  tasks: Task[],
  phases: Phase[],
  runClaude: (prompt: string) => Promise<string>,
): Promise<ScheduleResult> {
  const ordered = buildOrderedSchedule(
    tasks.filter(t => t.projectId === projectId),
    phases.filter(p => p.projectId === projectId),
  )
  const hash = hashSchedule(projectId, ordered)
  const cached = cache.get(projectId)
  if (cached && cached.hash === hash) return cached.result

  const taskMap = new Map(tasks.map(t => [t.id, t]))
  const llmIdx = await computeSplitIndexLLM(
    ordered,
    id => taskMap.get(id) ?? null,
    runClaude,
  )

  const splitIndex = llmIdx ?? fallbackSplitIndex(ordered)
  const result: ScheduleResult = {
    ordered,
    splitIndex,
    splitSource: llmIdx == null ? 'fallback' : 'llm',
    computedAt: new Date().toISOString(),
  }
  cache.set(projectId, { hash, result })
  return result
}

export function invalidateCache(projectId?: string): void {
  if (projectId) cache.delete(projectId)
  else cache.clear()
}

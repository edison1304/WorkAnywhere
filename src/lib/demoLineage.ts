import type { Task, Phase } from '../../shared/types'

/**
 * Demo-only seed injector for TreeSidebar fork (↳) / depends-on (⇠) chips.
 *
 * Gated by `localStorage.demoLineage === '1'`. Off by default → no effect on
 * real users. Idempotent: only writes fields that are currently unset, and
 * only flips status when it's safe ('idle' or 'queued').
 *
 * Target: the first phase by `order`. Inside it, the task at order=1 gets a
 * forkedFromId pointing at order=0; the task at order=2 gets a dependsOn
 * pointing at order=1 (and order=1 is nudged to 'waiting' if it was idle, so
 * the blocked chip actually renders).
 */
export function applyDemoLineage(tasks: Task[], phases: Phase[]): Task[] {
  if (typeof window === 'undefined') return tasks
  if (window.localStorage?.getItem('demoLineage') !== '1') return tasks
  if (!tasks.length || !phases.length) return tasks

  const firstPhase = [...phases].sort((a, b) => a.order - b.order)[0]
  if (!firstPhase) return tasks

  const phaseTasks = tasks
    .filter(t => t.phaseId === firstPhase.id)
    .sort((a, b) => a.order - b.order)
  if (phaseTasks.length < 2) return tasks

  const [t0, t1, t2] = phaseTasks
  const patches = new Map<string, Partial<Task>>()

  if (t1 && !t1.forkedFromId) {
    patches.set(t1.id, { ...(patches.get(t1.id) ?? {}), forkedFromId: t0.id })
  }
  if (t2 && (!t2.dependsOn || t2.dependsOn.length === 0)) {
    patches.set(t2.id, { ...(patches.get(t2.id) ?? {}), dependsOn: [t1.id] })
    if (t1.status === 'idle' || t1.status === 'queued') {
      patches.set(t1.id, { ...(patches.get(t1.id) ?? {}), status: 'waiting' })
    }
  }

  if (!patches.size) return tasks
  return tasks.map(t => (patches.has(t.id) ? { ...t, ...patches.get(t.id)! } : t))
}

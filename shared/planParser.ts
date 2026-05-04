import type { ChecklistItem, JudgmentEntry, Plan } from './types'

/**
 * Shared plan parser — pure functions, no IO. Used by both the backend
 * (writes parse results back to disk) and the frontend (derives live plan
 * from task.logs to drive UI progress + insights).
 */

/** Match checklist line: "- [ ] text" or "- [x] text" or "* [X] text" etc. */
const CHECK_RE = /^\s*[-*+]\s*\[([ xX])\]\s+(.+?)\s*$/gm

/** Match a judgment line in NOTES style: "↳ decision — reason" */
const JUDGMENT_RE = /^\s*↳\s+(.+?)\s+[—–-]\s+(.+?)\s*$/gm

/** Match a retrospective section header. Captures everything until next H2. */
const RETRO_RE = /##\s*(?:4\.\s*)?(?:Retrospective|회고)\b[^\n]*\n([\s\S]*?)(?=\n##\s|$)/i

/** Stable id for a checklist item — derived from text so the same item across
 *  parses gets the same id, allowing UI checkbox state to persist. */
function checklistId(text: string): string {
  let h = 0
  for (let i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0
  return `c${(h >>> 0).toString(36)}`
}

export function parseChecklistItems(text: string): ChecklistItem[] {
  CHECK_RE.lastIndex = 0
  const items: ChecklistItem[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = CHECK_RE.exec(text)) !== null) {
    const done = m[1] === 'x' || m[1] === 'X'
    const itemText = m[2].trim()
    if (!itemText) continue
    const id = checklistId(itemText)
    if (seen.has(id)) {
      // duplicate text — let later "done" override earlier "not done"
      if (done) {
        const existing = items.find(it => it.id === id)
        if (existing && !existing.done) {
          existing.done = true
          existing.doneAt = new Date().toISOString()
        }
      }
      continue
    }
    seen.add(id)
    items.push({
      id,
      text: itemText,
      done,
      ...(done ? { doneAt: new Date().toISOString() } : {}),
    })
  }
  return items
}

export function parseJudgments(text: string): JudgmentEntry[] {
  JUDGMENT_RE.lastIndex = 0
  const entries: JudgmentEntry[] = []
  let m: RegExpExecArray | null
  while ((m = JUDGMENT_RE.exec(text)) !== null) {
    entries.push({
      timestamp: new Date().toISOString(),
      decision: m[1].trim(),
      reason: m[2].trim(),
    })
  }
  return entries
}

export function parseRetrospective(text: string): string | undefined {
  const m = text.match(RETRO_RE)
  if (!m) return undefined
  const body = m[1].trim()
  return body || undefined
}

/**
 * Build a Plan from raw text accumulated across all task logs.
 * Caller passes the concatenated text-type log content. We do not infer
 * `design` from logs (that lives in PLAN.md, owned separately).
 */
export function buildPlanFromLogs(
  combinedText: string,
  base?: Plan,
): Plan {
  const checklist = parseChecklistItems(combinedText)
  const newJudgments = parseJudgments(combinedText)
  const retrospective = parseRetrospective(combinedText)

  // Merge judgments: dedupe by (decision + reason) preserving original timestamps.
  const seen = new Map<string, JudgmentEntry>()
  for (const e of base?.judgmentLog ?? []) {
    seen.set(`${e.decision}|${e.reason}`, e)
  }
  for (const e of newJudgments) {
    const key = `${e.decision}|${e.reason}`
    if (!seen.has(key)) seen.set(key, e)
  }

  // Merge checklist: preserve doneAt from base if item was already marked.
  const baseById = new Map((base?.checklist ?? []).map(it => [it.id, it]))
  const mergedChecklist = checklist.map(it => {
    const prev = baseById.get(it.id)
    if (prev?.done && it.done) return prev  // keep original doneAt
    return it
  })

  return {
    design: base?.design ?? '',
    checklist: mergedChecklist,
    judgmentLog: Array.from(seen.values()),
    retrospective: retrospective ?? base?.retrospective,
    generatedAt: base?.generatedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

/** Render checklist items back to markdown (for writing CHECKLIST.md). */
export function renderChecklistMarkdown(items: ChecklistItem[], header = '# Checklist'): string {
  const body = items.length === 0
    ? '\n(체크리스트 없음)\n'
    : '\n' + items.map(it => `- [${it.done ? 'x' : ' '}] ${it.text}`).join('\n') + '\n'
  return `${header}\n${body}`
}

/** Render judgment entries to NOTES.md format (append-friendly). */
export function renderJudgmentsMarkdown(entries: JudgmentEntry[]): string {
  if (entries.length === 0) return ''
  return entries.map(e => `↳ ${e.decision} — ${e.reason}`).join('\n')
}

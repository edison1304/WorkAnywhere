/**
 * permissionDetector — pulls "do you want to..." style approval prompts
 * out of the raw PTY stream so we can surface them in the chat UI.
 *
 * Keeps a small rolling buffer per task (since prompts arrive in chunks).
 * When a complete prompt is recognised, returns a snapshot + a reset hint.
 */

const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]/g

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '').replace(/\r/g, '')
}

export interface PermissionPrompt {
  /** Cleaned text to show in the chat card. */
  text: string
  /** Format we detected — drives the approve/deny payload. */
  format: 'numbered' | 'yn'
}

// Phrases claude code uses for its permission prompts. We match loosely so
// minor wording changes don't break the detector.
const TRIGGER_RE = /(do you want to|allow this action|approve this|make this edit|proceed\?)/i

// Numbered options block: "1. Yes" "2. Yes, and don't ask again" "3. No"
const NUMBERED_RE = /^\s*1\.\s+/m

// y/N suffix
const YN_RE = /\(\s*y\s*\/\s*n\s*\)/i

interface State {
  buffer: string
  lastEmitTs: number
}

const state = new Map<string, State>()

const MAX_BUFFER = 4000
const MIN_INTERVAL_MS = 800  // suppress duplicate detections from chunked output

/** Feed a new chunk of PTY output. Returns a prompt only when one is detected. */
export function feed(taskId: string, chunk: string): PermissionPrompt | null {
  let s = state.get(taskId)
  if (!s) { s = { buffer: '', lastEmitTs: 0 }; state.set(taskId, s) }

  const cleaned = stripAnsi(chunk)
  s.buffer = (s.buffer + cleaned).slice(-MAX_BUFFER)

  if (!TRIGGER_RE.test(s.buffer)) return null

  const isNumbered = NUMBERED_RE.test(s.buffer)
  const isYn = YN_RE.test(s.buffer)
  if (!isNumbered && !isYn) return null

  // Debounce: don't fire again within MIN_INTERVAL for the same task.
  const now = Date.now()
  if (now - s.lastEmitTs < MIN_INTERVAL_MS) return null
  s.lastEmitTs = now

  // Extract a tidy snippet around the trigger
  const triggerIdx = s.buffer.search(TRIGGER_RE)
  const start = Math.max(0, triggerIdx - 200)
  const text = s.buffer.slice(start).trim()

  // Reset buffer so we don't keep re-matching the same prompt
  s.buffer = ''

  return { text, format: isNumbered ? 'numbered' : 'yn' }
}

/** Drop per-task state on cleanup. */
export function reset(taskId: string): void {
  state.delete(taskId)
}

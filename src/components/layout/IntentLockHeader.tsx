import { useState, useRef, useEffect } from 'react'
import type { Task, IntentLock } from '../../../shared/types'
import styles from './IntentLockHeader.module.css'

interface Props {
  task: Task
  /** Optional — when provided, cells become inline-editable. */
  onUpdate?: (taskId: string, patch: Partial<Task>) => void
}

/**
 * Intent Lock — work_anywhere_context_summary_ui.md §10 + §15.1.
 *
 * Three fixed cells:
 *   1) 본목적 — task.purpose (text, click-to-edit)
 *   2) 건드리면 안 되는 것 — task.intentLock?.mustNotTouch[] (chips, always editable)
 *   3) 성공 기준 — task.intentLock?.successCriteria (text, click-to-edit)
 *
 * Empty values render a muted placeholder. The placeholder is itself
 * clickable so the user can fill it in — this is the "lock down what's
 * out of scope before the agent drifts" feedback loop the spec calls for.
 */
export function IntentLockHeader({ task, onUpdate }: Props) {
  const editable = !!onUpdate
  const purpose = task.purpose?.trim() ?? ''
  const mustNot = task.intentLock?.mustNotTouch ?? []
  const success = task.intentLock?.successCriteria?.trim() ?? ''

  // Don't render at all when nothing is set AND there's no editor to invite input.
  if (!editable && !purpose && mustNot.length === 0 && !success) return null

  const updatePurpose = (next: string) => {
    if (!onUpdate) return
    if (next.trim() === purpose) return
    onUpdate(task.id, { purpose: next })
  }

  const updateLock = (patch: Partial<IntentLock>) => {
    if (!onUpdate) return
    const nextLock: IntentLock = { ...task.intentLock, ...patch }
    onUpdate(task.id, { intentLock: nextLock })
  }

  const updateSuccess = (next: string) => {
    const trimmed = next.trim()
    if (trimmed === success) return
    updateLock({ successCriteria: trimmed || undefined })
  }

  const addMustNot = (value: string) => {
    const v = value.trim()
    if (!v) return
    if (mustNot.includes(v)) return
    updateLock({ mustNotTouch: [...mustNot, v] })
  }

  const removeMustNot = (idx: number) => {
    const next = mustNot.filter((_, i) => i !== idx)
    updateLock({ mustNotTouch: next.length ? next : undefined })
  }

  return (
    <div className={styles.band} data-testid="intent-lock-header">
      <div className={`${styles.cell} ${styles.cellPurpose}`}>
        <span className={styles.label}>
          <span className={styles.dot} data-tone="purpose" />
          본목적
        </span>
        <EditableText
          value={purpose}
          placeholder="(목적 미설정 — 클릭해서 입력)"
          editable={editable}
          onCommit={updatePurpose}
        />
      </div>

      <div className={styles.cell}>
        <span className={styles.label}>
          <span className={styles.dot} data-tone="must-not" />
          건드리면 안 되는 것
        </span>
        <ChipList
          items={mustNot}
          editable={editable}
          emptyLabel="(제약 미설정)"
          onAdd={addMustNot}
          onRemove={removeMustNot}
        />
      </div>

      <div className={styles.cell}>
        <span className={styles.label}>
          <span className={styles.dot} data-tone="success" />
          성공 기준
        </span>
        <EditableText
          value={success}
          placeholder="(성공 기준 미설정 — 클릭해서 입력)"
          editable={editable}
          onCommit={updateSuccess}
        />
      </div>
    </div>
  )
}

// ─── EditableText ────────────────────────────────────────────────────
// Click to edit. Saves on blur or Enter (Shift+Enter inserts newline).
// Esc reverts. Auto-focuses + selects-all so the user can immediately type.
function EditableText({
  value,
  placeholder,
  editable,
  onCommit,
}: {
  value: string
  placeholder: string
  editable: boolean
  onCommit: (next: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const taRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (editing && taRef.current) {
      taRef.current.focus()
      taRef.current.select()
    }
  }, [editing])

  // External value changes (e.g., AI summary updated purpose) shouldn't
  // clobber a draft the user is typing — only sync when not editing.
  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  if (!editable) {
    return value
      ? <span className={styles.value}>{value}</span>
      : <span className={styles.valueMuted}>{placeholder.replace(' — 클릭해서 입력', '')}</span>
  }

  if (!editing) {
    return (
      <button
        type="button"
        className={value ? styles.valueButton : styles.valueButtonMuted}
        onClick={() => setEditing(true)}
        title="클릭해서 편집"
      >
        {value || placeholder}
      </button>
    )
  }

  const commit = () => {
    onCommit(draft)
    setEditing(false)
  }
  const cancel = () => {
    setDraft(value)
    setEditing(false)
  }

  return (
    <textarea
      ref={taRef}
      className={styles.editArea}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          cancel()
        }
      }}
      rows={Math.min(6, Math.max(1, draft.split('\n').length))}
    />
  )
}

// ─── ChipList ────────────────────────────────────────────────────────
// Always-visible chips. Each chip has × to remove. Inline input at end
// adds a new chip on Enter. No edit-mode toggle — this matches the
// natural affordance of tag-style inputs.
function ChipList({
  items,
  editable,
  emptyLabel,
  onAdd,
  onRemove,
}: {
  items: string[]
  editable: boolean
  emptyLabel: string
  onAdd: (value: string) => void
  onRemove: (idx: number) => void
}) {
  const [draft, setDraft] = useState('')

  if (!editable && items.length === 0) {
    return <span className={styles.valueMuted}>{emptyLabel}</span>
  }

  return (
    <div className={styles.chipRow}>
      {items.map((item, i) => (
        <span key={i} className={styles.chip}>
          <span>{item}</span>
          {editable && (
            <button
              type="button"
              className={styles.chipDelete}
              onClick={() => onRemove(i)}
              title="제거"
              aria-label={`${item} 제거`}
            >
              ×
            </button>
          )}
        </span>
      ))}
      {editable && (
        <input
          type="text"
          className={styles.chipInput}
          value={draft}
          placeholder={items.length === 0 ? '+ 제약 추가' : '+ 추가'}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onAdd(draft)
              setDraft('')
            } else if (e.key === 'Escape') {
              setDraft('')
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          onBlur={() => {
            if (draft.trim()) {
              onAdd(draft)
              setDraft('')
            }
          }}
        />
      )}
    </div>
  )
}

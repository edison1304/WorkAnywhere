import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import styles from './HoverPanel.module.css'

interface Props {
  /** Trigger node — typically a card or row. Mouse on this opens the panel. */
  children: ReactNode
  /** Panel content. Render-prop so callers can compose layout. */
  panel: ReactNode
  /** Hover delay before opening (ms). Default 220 — tuned to avoid flicker on quick passes. */
  openDelay?: number
  /** Disable opening (e.g., when no insight is available). */
  disabled?: boolean
  /** Fixed width of the panel; default 320. */
  width?: number
}

/**
 * HoverPanel — wraps any element. On hover, opens a positioned floating panel.
 * Uses a portal so the panel escapes overflow:hidden parents.
 *
 * Position rules:
 *   - prefers right of the trigger
 *   - flips to left if not enough room
 *   - vertically aligned to trigger top, clamped to viewport
 */
export function HoverPanel({ children, panel, openDelay = 220, disabled, width = 320 }: Props) {
  const triggerRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; flipped: boolean } | null>(null)
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelOpen = () => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current)
      openTimerRef.current = null
    }
  }

  const computePosition = () => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const margin = 8
    const vw = window.innerWidth
    const vh = window.innerHeight

    let left = rect.right + margin
    let flipped = false
    if (left + width > vw - margin) {
      // not enough room on the right → flip to left
      left = rect.left - width - margin
      flipped = true
    }
    if (left < margin) left = margin

    // Vertical: align to trigger top, clamp inside viewport.
    // Panel height is unknown until rendered — use heuristic clamp below.
    let top = rect.top
    if (top + 200 > vh - margin) {
      top = Math.max(margin, vh - 220)
    }
    setPos({ top, left, flipped })
  }

  const handleEnter = () => {
    if (disabled) return
    cancelOpen()
    openTimerRef.current = setTimeout(() => {
      computePosition()
      setOpen(true)
    }, openDelay)
  }

  const handleLeave = () => {
    cancelOpen()
    setOpen(false)
  }

  // Recompute on scroll / resize while open
  useEffect(() => {
    if (!open) return
    const onScroll = () => computePosition()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  useEffect(() => {
    return () => cancelOpen()
  }, [])

  return (
    <div
      ref={triggerRef}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      style={{ display: 'contents' }}
    >
      {children}
      {open && pos && createPortal(
        <div
          className={`${styles.panel} ${pos.flipped ? styles.flipped : ''}`}
          style={{ top: pos.top, left: pos.left, width }}
          // Panel itself is non-interactive — informational only.
          // Mouse over panel is treated as "still hovering" (no leave fired).
          onMouseEnter={cancelOpen}
        >
          {panel}
        </div>,
        document.body,
      )}
    </div>
  )
}

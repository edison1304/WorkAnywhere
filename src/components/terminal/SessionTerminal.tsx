import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import styles from './SessionTerminal.module.css'

// Global terminal pool — survives component re-renders and tab switches
const terminalPool = new Map<string, {
  terminal: Terminal
  fitAddon: FitAddon
  cleanupPty: () => void
  container: HTMLDivElement
}>()

interface Props {
  taskId: string
}

export function SessionTerminal({ taskId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current || !window.api) return
    const host = containerRef.current

    // Already exists — just re-attach the DOM element
    const existing = terminalPool.get(taskId)
    if (existing) {
      // Move the existing terminal DOM into this container
      if (existing.container.parentElement !== host) {
        host.appendChild(existing.container)
      }
      // Re-fit after re-attach
      requestAnimationFrame(() => {
        try { existing.fitAddon.fit() } catch {}
      })
      return
    }

    // Create new terminal
    const termContainer = document.createElement('div')
    termContainer.style.width = '100%'
    termContainer.style.height = '100%'
    host.appendChild(termContainer)

    const terminal = new Terminal({
      theme: {
        background: '#0f0f0f',
        foreground: '#e5e5e5',
        cursor: '#6366f1',
        selectionBackground: '#6366f140',
        black: '#0f0f0f',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#e5e5e5',
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 10000,
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(termContainer)

    requestAnimationFrame(() => {
      try { fitAddon.fit() } catch {}
    })

    // Send terminal input to PTY
    terminal.onData((data) => {
      window.api.ptyWrite(taskId, data)
    })

    // Receive PTY output
    const cleanupPty = window.api.onPtyData(({ taskId: tid, data }) => {
      if (tid === taskId) {
        terminal.write(data)
      }
    })

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit()
        window.api.ptyResize(taskId, terminal.cols, terminal.rows)
      } catch {}
    })
    resizeObserver.observe(host)

    // Store in pool
    terminalPool.set(taskId, {
      terminal,
      fitAddon,
      cleanupPty: () => {
        resizeObserver.disconnect()
        cleanupPty()
      },
      container: termContainer,
    })

    // Do NOT return cleanup — terminal lives forever in pool
  }, [taskId])

  return (
    <div className={styles.terminalContainer}>
      <div ref={containerRef} className={styles.terminal} />
    </div>
  )
}

// Call this to explicitly destroy a terminal (e.g., when user clicks "Close")
export function destroyTerminal(taskId: string): void {
  const entry = terminalPool.get(taskId)
  if (entry) {
    entry.cleanupPty()
    entry.terminal.dispose()
    entry.container.remove()
    terminalPool.delete(taskId)
  }
}

// Get active terminal count
export function getActiveTerminalCount(): number {
  return terminalPool.size
}

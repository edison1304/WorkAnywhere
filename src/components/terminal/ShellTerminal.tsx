import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import styles from './SessionTerminal.module.css'

// Global shell terminal pool (persists across tab switches)
const shellPool = new Map<string, { terminal: Terminal; fit: FitAddon }>()

interface Props {
  projectId: string
}

export function ShellTerminal({ projectId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [shellId, setShellId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Open shell on mount
  useEffect(() => {
    if (!window.api || !projectId) return
    let cancelled = false

    window.api.shellOpen(projectId).then(result => {
      if (cancelled) return
      if (result.success && result.shellId) {
        setShellId(result.shellId)
      } else {
        setError(result.error || 'Failed to open shell')
      }
    })

    return () => { cancelled = true }
  }, [projectId])

  // Setup terminal
  useEffect(() => {
    if (!shellId || !containerRef.current || !window.api) return

    let entry = shellPool.get(shellId)
    if (!entry) {
      const terminal = new Terminal({
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
        theme: {
          background: '#0f0f0f',
          foreground: '#e5e5e5',
          cursor: '#e5e5e5',
          selectionBackground: '#6366f180',
        },
        cursorBlink: true,
        scrollback: 5000,
      })
      const fit = new FitAddon()
      terminal.loadAddon(fit)
      entry = { terminal, fit }
      shellPool.set(shellId, entry)

      // Terminal input → shell
      terminal.onData((data) => {
        window.api.shellWrite(shellId, data)
      })
    }

    const { terminal, fit } = entry

    // Mount
    if (!terminal.element) {
      terminal.open(containerRef.current)
    } else {
      containerRef.current.appendChild(terminal.element)
    }

    setTimeout(() => {
      fit.fit()
      window.api.shellResize(shellId, terminal.cols, terminal.rows)
    }, 100)

    // Shell output → terminal
    const unsubData = window.api.onShellData(({ shellId: sid, data }) => {
      if (sid === shellId) terminal.write(data)
    })

    const unsubClose = window.api.onShellClose(({ shellId: sid }) => {
      if (sid === shellId) {
        terminal.write('\r\n[Shell closed]\r\n')
        setShellId(null)
      }
    })

    // Resize observer
    const observer = new ResizeObserver(() => {
      fit.fit()
      window.api.shellResize(shellId, terminal.cols, terminal.rows)
    })
    observer.observe(containerRef.current)

    return () => {
      unsubData()
      unsubClose()
      observer.disconnect()
    }
  }, [shellId])

  if (error) {
    return (
      <div style={{ padding: 16, color: 'var(--error)', fontSize: 13 }}>
        Shell error: {error}
      </div>
    )
  }

  return <div ref={containerRef} className={styles.terminal} />
}

import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import styles from './SessionTerminal.module.css'

interface Props {
  taskId: string
  isActive: boolean
}

export function SessionTerminal({ taskId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const currentTaskRef = useRef<string | null>(null)

  useEffect(() => {
    if (!containerRef.current || !window.api) return

    // Same task — don't recreate
    if (currentTaskRef.current === taskId && terminalRef.current) return

    // Different task — cleanup old terminal
    if (cleanupRef.current) {
      cleanupRef.current()
      cleanupRef.current = null
    }
    if (terminalRef.current) {
      terminalRef.current.dispose()
      terminalRef.current = null
    }

    currentTaskRef.current = taskId

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
    terminal.open(containerRef.current)

    // Delay fit to ensure container is visible
    requestAnimationFrame(() => {
      try { fitAddon.fit() } catch {}
    })

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    // Send terminal input to PTY
    const dataDisposable = terminal.onData((data) => {
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
    resizeObserver.observe(containerRef.current)

    // Store cleanup for later (NOT on unmount — only on task change)
    cleanupRef.current = () => {
      resizeObserver.disconnect()
      cleanupPty()
      dataDisposable.dispose()
    }

    // Only cleanup terminal on full unmount (component removed from DOM)
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current()
        cleanupRef.current = null
      }
      if (terminalRef.current) {
        terminalRef.current.dispose()
        terminalRef.current = null
      }
      currentTaskRef.current = null
    }
  }, [taskId])

  return (
    <div className={styles.terminalContainer}>
      <div ref={containerRef} className={styles.terminal} />
    </div>
  )
}

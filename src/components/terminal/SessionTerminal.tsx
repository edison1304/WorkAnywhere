import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import styles from './SessionTerminal.module.css'

interface Props {
  taskId: string
  isActive: boolean
}

export function SessionTerminal({ taskId, isActive }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    if (!containerRef.current || !isActive) return

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
    fitAddon.fit()

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    // Send terminal input to PTY via IPC
    terminal.onData((data) => {
      if (window.api) {
        // @ts-ignore - pty:write is sent via ipcRenderer.send
        window.api.syncState({ type: 'pty:write', taskId, data })
      }
    })

    // Listen for PTY output
    let cleanupPty: (() => void) | undefined
    if (window.api) {
      cleanupPty = window.api.onStateSync((msg: any) => {
        if (msg?.type === 'pty:data' && msg.taskId === taskId) {
          terminal.write(msg.data)
        }
      })
    }

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit()
        if (window.api) {
          // @ts-ignore
          window.api.syncState({
            type: 'pty:resize', taskId,
            cols: terminal.cols, rows: terminal.rows
          })
        }
      } catch { /* ignore resize errors */ }
    })
    resizeObserver.observe(containerRef.current)

    // Welcome message
    terminal.writeln('\x1b[36m╭─ Workanywhere Terminal ─╮\x1b[0m')
    terminal.writeln('\x1b[36m│\x1b[0m Connected via SSH')
    terminal.writeln('\x1b[36m│\x1b[0m Claude Code agent ready')
    terminal.writeln('\x1b[36m╰─────────────────────────╯\x1b[0m')
    terminal.writeln('')

    return () => {
      resizeObserver.disconnect()
      cleanupPty?.()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [taskId, isActive])

  return (
    <div className={styles.terminalContainer}>
      <div ref={containerRef} className={styles.terminal} />
    </div>
  )
}

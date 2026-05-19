import type { Client, ClientChannel } from 'ssh2'

interface QueueEntry {
  command: string
  resolve: (output: string) => void
  reject: (err: Error) => void
}

/**
 * PersistentShell — multiplexes short-lived commands through a single
 * SSH shell channel instead of opening a new exec channel per command.
 *
 * Commands are queued and executed serially. Output is delimited by
 * unique markers so each caller gets exactly its own output back.
 */
export class PersistentShell {
  private channel: ClientChannel | null = null
  private buffer = ''
  private queue: QueueEntry[] = []
  private currentId: string | null = null
  private currentOutput = ''
  private currentResolve: ((out: string) => void) | null = null
  private currentReject: ((err: Error) => void) | null = null
  private capturing = false
  private alive = false
  private initPromise: Promise<void> | null = null
  private commandTimeout: ReturnType<typeof setTimeout> | null = null

  private static readonly CMD_TIMEOUT_MS = 60_000

  constructor(
    private client: Client,
    private onDeath?: () => void,
  ) {}

  /**
   * Open the shell channel and initialize it (disable echo, clear prompts).
   * Safe to call multiple times — returns the same promise if already initializing.
   */
  async init(): Promise<void> {
    if (this.alive && this.channel) return
    if (this.initPromise) return this.initPromise

    this.initPromise = new Promise<void>((resolve, reject) => {
      this.client.shell(
        { term: 'dumb', rows: 0, cols: 0 },
        (err, stream) => {
          if (err) {
            this.initPromise = null
            return reject(err)
          }

          this.channel = stream
          this.alive = true
          this.buffer = ''

          stream.on('data', (data: Buffer) => {
            this.onData(data.toString())
          })

          stream.stderr.on('data', (data: Buffer) => {
            // Merge stderr into buffer — mirrors old exec() behavior
            this.onData(data.toString())
          })

          stream.on('error', (e: Error) => {
            console.error('[PersistentShell] stream error:', e.message)
            this.die()
          })

          stream.on('close', () => {
            console.log('[PersistentShell] stream closed')
            this.die()
          })

          // Initialize shell: disable echo, clear all prompts
          stream.write(
            "stty -echo 2>/dev/null; export PS1='' PS2='' PROMPT_COMMAND=''; set +o history 2>/dev/null\n",
          )

          // Use a ready marker to know when init is done
          const readyId = this.genId()
          const readyMarker = `<<<WA_READY_${readyId}>>>`
          stream.write(`echo '${readyMarker}'\n`)

          const checkReady = () => {
            if (this.buffer.includes(readyMarker)) {
              // Discard everything up to and including the ready marker line
              const idx = this.buffer.indexOf(readyMarker)
              this.buffer = this.buffer.substring(idx + readyMarker.length)
              // Also trim the trailing newline
              if (this.buffer.startsWith('\n')) this.buffer = this.buffer.substring(1)
              this.buffer = ''
              this.initPromise = null
              resolve()
            } else {
              setTimeout(checkReady, 50)
            }
          }
          // Give it a generous window; if it doesn't respond in 10s, fail
          const timeout = setTimeout(() => {
            this.initPromise = null
            reject(new Error('PersistentShell init timed out'))
          }, 10_000)

          const poll = () => {
            if (this.buffer.includes(readyMarker)) {
              clearTimeout(timeout)
              const idx = this.buffer.indexOf(readyMarker)
              this.buffer = this.buffer.substring(idx + readyMarker.length)
              if (this.buffer.startsWith('\n')) this.buffer = this.buffer.substring(1)
              this.buffer = ''
              this.initPromise = null
              resolve()
            } else if (this.alive) {
              setTimeout(poll, 50)
            }
          }
          poll()
        },
      )
    })

    return this.initPromise
  }

  /**
   * Execute a command and return its stdout+stderr output.
   * Commands are queued and run serially through the persistent shell.
   */
  exec(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.alive) {
        return reject(new Error('PersistentShell is dead'))
      }
      this.queue.push({ command, resolve, reject })
      this.processNext()
    })
  }

  get isAlive(): boolean {
    return this.alive
  }

  destroy(): void {
    this.alive = false
    if (this.commandTimeout) {
      clearTimeout(this.commandTimeout)
      this.commandTimeout = null
    }
    this.channel?.destroy()
    this.channel = null
    this.rejectAll(new Error('PersistentShell destroyed'))
  }

  // ─── Internal ───

  private genId(): string {
    return Math.random().toString(36).slice(2, 10)
  }

  private processNext(): void {
    if (this.currentId || this.queue.length === 0 || !this.alive) return

    const { command, resolve, reject } = this.queue.shift()!
    const id = this.genId()

    this.currentId = id
    this.currentOutput = ''
    this.currentResolve = resolve
    this.currentReject = reject
    this.capturing = false

    const startMarker = `<<<WA_S_${id}>>>`
    const endMarker = `<<<WA_E_${id}>>>`

    // Set a timeout — if the command doesn't finish, reject and reset
    this.commandTimeout = setTimeout(() => {
      console.error(`[PersistentShell] command timed out (${PersistentShell.CMD_TIMEOUT_MS}ms): ${command.slice(0, 100)}`)
      // Send Ctrl-C to kill stuck command
      this.channel?.write('\x03\n')
      const rej = this.currentReject
      this.currentId = null
      this.currentResolve = null
      this.currentReject = null
      this.currentOutput = ''
      this.capturing = false
      rej?.(new Error('Command timed out'))
      this.processNext()
    }, PersistentShell.CMD_TIMEOUT_MS)

    // Write the command wrapped with markers
    // Using printf to avoid echo interpreting escape sequences
    this.channel!.write(
      `printf '%s\\n' '${startMarker}'\n` +
      `${command} 2>&1\n` +
      `printf '%s\\n' '${endMarker}'\n`,
    )
  }

  private onData(data: string): void {
    this.buffer += data

    if (!this.currentId) return

    const startMarker = `<<<WA_S_${this.currentId}>>>`
    const endMarker = `<<<WA_E_${this.currentId}>>>`

    // Start capturing after start marker
    if (!this.capturing) {
      const startIdx = this.buffer.indexOf(startMarker)
      if (startIdx === -1) return
      // Discard everything up to and including the start marker line
      const afterStart = startIdx + startMarker.length
      // Skip the newline after the marker
      const lineEnd = this.buffer.indexOf('\n', afterStart)
      if (lineEnd === -1) return
      this.buffer = this.buffer.substring(lineEnd + 1)
      this.capturing = true
    }

    // Look for end marker
    const endIdx = this.buffer.indexOf(endMarker)
    if (endIdx === -1) {
      // Haven't seen end marker yet — accumulate
      // Move fully-consumed data to currentOutput to avoid unbounded buffer growth
      // But keep the buffer since end marker might span a chunk boundary
      return
    }

    // Found end marker — extract output
    this.currentOutput = this.buffer.substring(0, endIdx)
    // Remove trailing newline before end marker
    if (this.currentOutput.endsWith('\n')) {
      this.currentOutput = this.currentOutput.slice(0, -1)
    }

    // Clear buffer past end marker
    const afterEnd = endIdx + endMarker.length
    const nextNewline = this.buffer.indexOf('\n', afterEnd)
    this.buffer = nextNewline === -1 ? '' : this.buffer.substring(nextNewline + 1)

    // Resolve
    if (this.commandTimeout) {
      clearTimeout(this.commandTimeout)
      this.commandTimeout = null
    }

    const output = this.currentOutput
    const resolve = this.currentResolve

    this.currentId = null
    this.currentOutput = ''
    this.currentResolve = null
    this.currentReject = null
    this.capturing = false

    resolve?.(output)
    this.processNext()
  }

  private die(): void {
    if (!this.alive) return
    this.alive = false
    if (this.commandTimeout) {
      clearTimeout(this.commandTimeout)
      this.commandTimeout = null
    }
    this.channel = null
    this.rejectAll(new Error('PersistentShell channel died'))
    this.onDeath?.()
  }

  private rejectAll(err: Error): void {
    if (this.currentReject) {
      this.currentReject(err)
      this.currentId = null
      this.currentResolve = null
      this.currentReject = null
    }
    for (const entry of this.queue) {
      entry.reject(err)
    }
    this.queue = []
  }
}

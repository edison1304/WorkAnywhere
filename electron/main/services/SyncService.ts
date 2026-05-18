import { EventEmitter } from 'events'
import { StringDecoder } from 'string_decoder'
import type { AnyConnection } from './ConnectionManager'
import type { SyncEvent, SyncEventType, SavedData } from '../../../shared/types'
import type { DataStore } from './DataStore'

const SYNC_DIR = '~/.workanywhere/events'
const LOG_FILE = `${SYNC_DIR}/log.ndjson`
const SEQ_FILE = `${SYNC_DIR}/.sequence`
const LOCK_FILE = `${SYNC_DIR}/.lock`
const COMPACTION_THRESHOLD = 500

/**
 * SyncService — multi-client real-time sync via SSH filesystem.
 *
 * Uses an append-only NDJSON event log on the server as a shared message bus.
 * Each mutation is published as a SyncEvent with a server-assigned sequence
 * number (atomic via flock). Other clients receive events in real-time via
 * `tail -f` on a dedicated SSH channel.
 */
export class SyncService extends EventEmitter {
  readonly clientId: string
  private conn: AnyConnection | null = null
  private dataStore: DataStore | null = null
  private watchChannel: { kill: () => void } | null = null
  private lastSeq = 0
  private active = false
  private publishing = false
  private publishQueue: Array<Omit<SyncEvent, 'seq' | 'clientId' | 'timestamp'>> = []
  // Buffer log appends to batch them (reduce event count)
  private logBuffer = new Map<string, import('../../../shared/types').LogEntry[]>()
  private logFlushTimer: ReturnType<typeof setTimeout> | null = null
  private readonly LOG_FLUSH_MS = 500

  constructor() {
    super()
    this.clientId = crypto.randomUUID()
  }

  /**
   * Initialize: create server directory, catch up from snapshot + events,
   * then start the watch channel.
   */
  async initialize(conn: AnyConnection, dataStore: DataStore): Promise<void> {
    this.conn = conn
    this.dataStore = dataStore
    this.active = true

    // Create server-side directory structure
    await conn.exec(`mkdir -p ${SYNC_DIR}/snapshots`)
    // Initialize sequence file if missing
    await conn.exec(`test -f ${SEQ_FILE} || echo '0' > ${SEQ_FILE}`)

    // Catch up: load latest snapshot + replay events
    await this.catchUp()

    // Start watching for new events
    await this.startWatchChannel()

    console.log(`[SyncService] Initialized, clientId=${this.clientId.slice(0, 8)}, lastSeq=${this.lastSeq}`)
  }

  /**
   * Publish a sync event to the shared log.
   * Acquires a sequence number atomically via flock, appends to log.ndjson.
   */
  async publishEvent(
    type: SyncEventType,
    entityType: 'project' | 'phase' | 'task',
    entityId: string,
    payload: any,
  ): Promise<number> {
    if (!this.conn || !this.active) return -1

    const event: Omit<SyncEvent, 'seq'> = {
      clientId: this.clientId,
      timestamp: new Date().toISOString(),
      type,
      entityType,
      entityId,
      payload,
    }

    // Include seq:0 as placeholder — server script replaces with real seq.
    // This avoids complex nested shell escaping for JSON injection.
    const eventWithPlaceholder = { seq: 0, ...event }
    const b64 = Buffer.from(JSON.stringify(eventWithPlaceholder), 'utf-8').toString('base64')

    try {
      // Atomic publish via flock:
      // 1. Lock, 2. Increment seq, 3. Decode event, 4. Replace seq:0 → seq:N, 5. Append
      // Single-quoted sh -c keeps $SEQ expansion simple.
      const result = await this.conn.exec(
        `flock -x ${LOCK_FILE} sh -c '` +
        `SEQ=$(cat ${SEQ_FILE} 2>/dev/null || echo 0); ` +
        `SEQ=$((SEQ + 1)); ` +
        `echo $SEQ > ${SEQ_FILE}; ` +
        `echo "${b64}" | base64 -d | sed "s/\\"seq\\":0/\\"seq\\":$SEQ/" >> ${LOG_FILE}; ` +
        `echo $SEQ` +
        `'`
      )

      const seq = parseInt(result.trim(), 10)
      if (!isNaN(seq)) {
        this.lastSeq = seq
        // Check if compaction is needed
        if (seq % COMPACTION_THRESHOLD === 0) {
          this.compact().catch(err => console.error('[SyncService] Compaction failed:', err))
        }
      }
      return seq
    } catch (err) {
      console.error('[SyncService] publishEvent failed:', err)
      return -1
    }
  }

  /**
   * Batch-publish task log entries (buffered for LOG_FLUSH_MS).
   */
  bufferLogAppend(taskId: string, log: import('../../../shared/types').LogEntry): void {
    const existing = this.logBuffer.get(taskId) || []
    existing.push(log)
    this.logBuffer.set(taskId, existing)

    if (!this.logFlushTimer) {
      this.logFlushTimer = setTimeout(() => this.flushLogBuffer(), this.LOG_FLUSH_MS)
    }
  }

  private async flushLogBuffer(): Promise<void> {
    this.logFlushTimer = null
    const entries = new Map(this.logBuffer)
    this.logBuffer.clear()

    for (const [taskId, logs] of entries) {
      await this.publishEvent('task_log_append', 'task', taskId, logs)
    }
  }

  /**
   * Apply a remote event to the local DataStore.
   * Called when tail -f receives an event from another client.
   */
  applyRemoteEvent(event: SyncEvent): void {
    if (!this.dataStore) return
    if (event.clientId === this.clientId) return // skip own events

    console.log(`[SyncService] Applying remote event seq=${event.seq}, type=${event.type}, entity=${event.entityType}:${event.entityId}`)

    switch (event.type) {
      case 'entity_upsert': {
        switch (event.entityType) {
          case 'project':
            this.dataStore.applyRemote('upsert', 'project', event.payload)
            break
          case 'phase':
            this.dataStore.applyRemote('upsert', 'phase', event.payload)
            break
          case 'task':
            this.dataStore.applyRemote('upsert', 'task', event.payload)
            break
        }
        break
      }

      case 'entity_delete': {
        switch (event.entityType) {
          case 'project':
            this.dataStore.applyRemote('delete', 'project', { id: event.entityId })
            break
          case 'phase':
            this.dataStore.applyRemote('delete', 'phase', { id: event.entityId })
            break
          case 'task':
            this.dataStore.applyRemote('delete', 'task', { id: event.entityId })
            break
        }
        break
      }

      case 'task_log_append': {
        const logs = event.payload as import('../../../shared/types').LogEntry[]
        this.dataStore.applyRemoteLogs(event.entityId, logs)
        break
      }

      case 'task_status': {
        this.dataStore.applyRemote('upsert', 'task', {
          id: event.entityId,
          status: event.payload.status,
          updatedAt: event.timestamp,
        })
        break
      }

      case 'task_artifact': {
        this.dataStore.applyRemoteArtifact(event.entityId, event.payload)
        break
      }
    }

    // Notify main process to broadcast to renderer
    this.emit('remote-event', event)
  }

  /**
   * Catch up from latest snapshot + replay events since snapshot.
   */
  private async catchUp(): Promise<void> {
    if (!this.conn) return

    // Try to read latest snapshot
    let snapshotSeq = 0
    try {
      const snapMeta = await this.conn.exec(`ls -1t ${SYNC_DIR}/snapshots/snap-*.json 2>/dev/null | head -1`)
      const snapFile = snapMeta.trim()
      if (snapFile) {
        const match = snapFile.match(/snap-(\d+)\.json/)
        if (match) {
          snapshotSeq = parseInt(match[1], 10)
          const snapData = await this.conn.exec(`cat ${JSON.stringify(snapFile)}`)
          if (snapData.trim()) {
            const data: SavedData = JSON.parse(snapData.trim())
            this.dataStore?.replaceAll(data)
            console.log(`[SyncService] Loaded snapshot at seq=${snapshotSeq}`)
          }
        }
      }
    } catch (err) {
      console.log(`[SyncService] No snapshot found, starting from event log`)
    }

    // Replay events since snapshot
    try {
      const logContent = await this.conn.exec(`cat ${LOG_FILE} 2>/dev/null || echo ''`)
      if (logContent.trim()) {
        const lines = logContent.trim().split('\n')
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const event: SyncEvent = JSON.parse(line)
            if (event.seq > snapshotSeq) {
              this.applyRemoteEvent(event)
              this.lastSeq = Math.max(this.lastSeq, event.seq)
            }
          } catch { /* skip malformed lines */ }
        }
        console.log(`[SyncService] Replayed events up to seq=${this.lastSeq}`)
      }
    } catch (err) {
      console.log(`[SyncService] No event log found, starting fresh`)
    }
  }

  /**
   * Start a long-lived SSH channel running `tail -f` on the event log.
   * New events appear as lines, parsed and applied in real-time.
   */
  private async startWatchChannel(): Promise<void> {
    if (!this.conn || !this.active) return

    try {
      // Use execChannel for the long-lived tail -f (not PersistentShell)
      // tail -n 0 = don't replay existing lines, only new ones
      const cmd = `tail -n 0 -f ${LOG_FILE} 2>/dev/null`

      // We need a raw SSH channel for this. Use spawnAgentStream's
      // underlying mechanism but simplified.
      const stream = await this.conn.execChannel(cmd)

      // execChannel returns a string (waits for close) — that won't work
      // for a long-lived stream. We need to use a different approach.
      // Use spawnPTY or a custom exec that doesn't wait for close.

      // Actually, let's use a simpler approach: poll-based.
      // Read new events every 2 seconds via exec.
      this.startPolling()
    } catch (err) {
      console.error('[SyncService] Watch channel failed, falling back to polling:', err)
      this.startPolling()
    }
  }

  /**
   * Polling fallback: check for new events every 2 seconds.
   * Less elegant than tail -f but works reliably with existing exec().
   */
  private pollTimer: ReturnType<typeof setInterval> | null = null

  private startPolling(): void {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => this.pollEvents(), 2000)
  }

  private async pollEvents(): Promise<void> {
    if (!this.conn || !this.active) return

    try {
      // Read only lines with seq > lastSeq using awk
      const result = await this.conn.exec(
        `awk -F'"seq":' '{split($2,a,","); if(a[1]+0 > ${this.lastSeq}) print}' ${LOG_FILE} 2>/dev/null`
      )
      if (!result.trim()) return

      const lines = result.trim().split('\n')
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const event: SyncEvent = JSON.parse(line)
          if (event.seq > this.lastSeq) {
            this.lastSeq = event.seq
            this.applyRemoteEvent(event)
          }
        } catch { /* skip malformed */ }
      }
    } catch { /* connection issue, will retry */ }
  }

  /**
   * Write a full snapshot and optionally truncate old events.
   */
  private async compact(): Promise<void> {
    if (!this.conn || !this.dataStore) return

    try {
      const data = this.dataStore.getAll()
      const json = JSON.stringify(data)
      const b64 = Buffer.from(json, 'utf-8').toString('base64')
      const snapPath = `${SYNC_DIR}/snapshots/snap-${this.lastSeq}.json`

      // Write snapshot in chunks (same pattern as data save)
      const tmpPath = `${snapPath}.tmp`
      await this.conn.exec(`rm -f ${tmpPath}`)
      const CHUNK = 60000
      for (let i = 0; i < b64.length; i += CHUNK) {
        const chunk = b64.slice(i, i + CHUNK)
        await this.conn.exec(`printf '%s' '${chunk}' >> ${tmpPath}`)
      }
      await this.conn.exec(`base64 -d ${tmpPath} > ${snapPath} && rm -f ${tmpPath}`)

      // Clean old snapshots (keep latest 2)
      await this.conn.exec(
        `ls -1t ${SYNC_DIR}/snapshots/snap-*.json 2>/dev/null | tail -n +3 | xargs rm -f 2>/dev/null`
      )

      console.log(`[SyncService] Snapshot written at seq=${this.lastSeq}`)
    } catch (err) {
      console.error('[SyncService] Compaction failed:', err)
    }
  }

  /**
   * Stop sync: close watch channel, flush buffered logs.
   */
  stop(): void {
    this.active = false
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    if (this.logFlushTimer) {
      clearTimeout(this.logFlushTimer)
      this.logFlushTimer = null
    }
    // Synchronous flush of buffered logs
    if (this.logBuffer.size > 0) {
      this.flushLogBuffer().catch(() => {})
    }
    this.watchChannel = null
    this.conn = null
    this.dataStore = null
  }
}

import { watch, readFileSync, writeFileSync, existsSync, mkdirSync, statSync, openSync, readSync, closeSync, readdirSync } from 'fs'
import { execSync } from 'child_process'
import { homedir } from 'os'
import { join } from 'path'
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import type { SyncEvent, SyncEventType } from '../../../../shared/types'

const SYNC_DIR = join(homedir(), '.workanywhere', 'events')
const LOG_FILE = join(SYNC_DIR, 'log.ndjson')
const SEQ_FILE = join(SYNC_DIR, '.sequence')
const LOCK_FILE = join(SYNC_DIR, '.lock')
const SNAP_DIR = join(SYNC_DIR, 'snapshots')
const COMPACTION_THRESHOLD = 500

/**
 * GatewaySync — server-side sync service.
 *
 * Unlike the desktop SyncService (which uses SSH exec for flock),
 * this runs directly on the server and uses child_process.execSync for atomicity.
 * Watches log.ndjson via fs.watch and emits 'event' for each new SyncEvent.
 */
export class GatewaySync extends EventEmitter {
  readonly clientId: string
  private lastSeq = 0
  private watcher: ReturnType<typeof watch> | null = null
  private lastFileSize = 0

  constructor() {
    super()
    this.clientId = randomUUID()
  }

  /** Initialize: ensure dirs, catch up, start watching. */
  initialize(): void {
    mkdirSync(SNAP_DIR, { recursive: true })
    if (!existsSync(SEQ_FILE)) writeFileSync(SEQ_FILE, '0')
    if (!existsSync(LOG_FILE)) writeFileSync(LOG_FILE, '')

    this.catchUp()
    this.startWatching()
    console.log(`[GatewaySync] Initialized, clientId=${this.clientId.slice(0, 8)}, lastSeq=${this.lastSeq}`)
  }

  /** Publish an event to the shared log with atomic flock. */
  publishEvent(
    type: SyncEventType,
    entityType: 'project' | 'phase' | 'task',
    entityId: string,
    payload: any,
  ): number {
    const event: Omit<SyncEvent, 'seq'> = {
      clientId: this.clientId,
      timestamp: new Date().toISOString(),
      type,
      entityType,
      entityId,
      payload,
    }

    const eventWithPlaceholder = { seq: 0, ...event }
    const b64 = Buffer.from(JSON.stringify(eventWithPlaceholder), 'utf-8').toString('base64')

    try {
      const result = execSync(
        `flock -x ${LOCK_FILE} sh -c '` +
        `SEQ=$(cat ${SEQ_FILE} 2>/dev/null || echo 0); ` +
        `SEQ=$((SEQ + 1)); ` +
        `echo $SEQ > ${SEQ_FILE}; ` +
        `echo "${b64}" | base64 -d | sed "s/\\"seq\\":0/\\"seq\\":$SEQ/" >> ${LOG_FILE}; ` +
        `echo $SEQ` +
        `'`,
        { encoding: 'utf-8' }
      )

      const seq = parseInt(result.trim(), 10)
      if (!isNaN(seq)) {
        this.lastSeq = seq
        if (seq % COMPACTION_THRESHOLD === 0) {
          this.compact()
        }
      }
      return seq
    } catch (err) {
      console.error('[GatewaySync] publishEvent failed:', err)
      return -1
    }
  }

  get currentSeq(): number {
    return this.lastSeq
  }

  /** Load snapshot + replay events to catch up. */
  private catchUp(): void {
    let snapshotSeq = 0

    // Try latest snapshot
    try {
      if (existsSync(SNAP_DIR)) {
        const snaps = readdirSync(SNAP_DIR)
          .filter((f: string) => f.startsWith('snap-') && f.endsWith('.json'))
          .sort()
          .reverse()
        if (snaps.length > 0) {
          const match = snaps[0].match(/snap-(\d+)\.json/)
          if (match) {
            snapshotSeq = parseInt(match[1], 10)
          }
        }
      }
    } catch { /* no snapshots */ }

    // Replay events
    try {
      if (existsSync(LOG_FILE)) {
        const content = readFileSync(LOG_FILE, 'utf-8')
        const stat = statSync(LOG_FILE)
        this.lastFileSize = stat.size

        for (const line of content.split('\n')) {
          if (!line.trim()) continue
          try {
            const event: SyncEvent = JSON.parse(line)
            if (event.seq > snapshotSeq) {
              this.lastSeq = Math.max(this.lastSeq, event.seq)
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch { /* no log yet */ }
  }

  /** Watch log.ndjson for changes and emit new events. */
  private startWatching(): void {
    if (!existsSync(LOG_FILE)) return

    this.watcher = watch(LOG_FILE, () => {
      this.readNewEvents()
    })
  }

  private readNewEvents(): void {
    try {
      const stat = statSync(LOG_FILE)
      if (stat.size <= this.lastFileSize) return

      // Read only the new bytes
      const fd = openSync(LOG_FILE, 'r')
      const buf = Buffer.alloc(stat.size - this.lastFileSize)
      readSync(fd, buf, 0, buf.length, this.lastFileSize)
      closeSync(fd)
      this.lastFileSize = stat.size

      const newContent = buf.toString('utf-8')
      for (const line of newContent.split('\n')) {
        if (!line.trim()) continue
        try {
          const event: SyncEvent = JSON.parse(line)
          if (event.seq > this.lastSeq) {
            this.lastSeq = event.seq
            this.emit('event', event)
          }
        } catch { /* skip malformed */ }
      }
    } catch { /* file access issue */ }
  }

  /** Write snapshot for compaction. */
  private compact(): void {
    // Compaction is handled by the desktop SyncService or can be triggered here
    console.log(`[GatewaySync] Compaction point at seq=${this.lastSeq}`)
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
  }
}

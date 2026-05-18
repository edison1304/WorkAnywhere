import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'http'
import type { GatewaySync } from '../services/GatewaySync'
import type { AgentBridge } from '../services/AgentBridge'
import type { SyncEvent } from '../../../../shared/types'
import type { WsServerEvent, WsClientEvent } from '../../../../shared/apiContract'
import { verifyWsToken } from '../auth/tokenAuth'

interface WsClient {
  ws: WebSocket
  lastSeq: number
  subscribedAt: number
}

/**
 * WebSocket sync channel — real-time event push to mobile clients.
 *
 * Listens to GatewaySync 'event' emissions and AgentBridge log/status/permission
 * events, then broadcasts to all connected WebSocket clients.
 */
export function setupSyncChannel(
  server: Server,
  sync: GatewaySync,
  agent: AgentBridge,
  token: string,
): void {
  const wss = new WebSocketServer({ server, path: '/ws/sync' })
  const clients = new Set<WsClient>()

  wss.on('connection', (ws, req) => {
    // Verify token
    if (!verifyWsToken(token, req as any)) {
      ws.close(4001, 'Unauthorized')
      return
    }

    const client: WsClient = { ws, lastSeq: 0, subscribedAt: Date.now() }
    clients.add(client)
    console.log(`[WS] Client connected (${clients.size} total)`)

    ws.on('message', (raw) => {
      try {
        const msg: WsClientEvent = JSON.parse(raw.toString())
        switch (msg.type) {
          case 'subscribe':
            client.lastSeq = msg.lastSeq
            break
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }))
            break
        }
      } catch { /* ignore malformed */ }
    })

    ws.on('close', () => {
      clients.delete(client)
      console.log(`[WS] Client disconnected (${clients.size} total)`)
    })
  })

  // Broadcast helper
  function broadcast(event: WsServerEvent): void {
    const msg = JSON.stringify(event)
    for (const client of clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(msg)
      }
    }
  }

  // ── Wire GatewaySync events → WebSocket ──

  sync.on('event', (event: SyncEvent) => {
    broadcast({ type: 'sync', event })

    // Also send typed events for convenience
    switch (event.type) {
      case 'task_status':
        broadcast({
          type: 'task:status',
          taskId: event.entityId,
          status: event.payload.status,
        })
        break
      case 'task_log_append':
        for (const log of Array.isArray(event.payload) ? event.payload : [event.payload]) {
          broadcast({
            type: 'task:log',
            taskId: event.entityId,
            log,
          })
        }
        break
      case 'task_artifact':
        broadcast({
          type: 'artifact:new',
          taskId: event.entityId,
          artifact: event.payload,
        })
        break
    }
  })

  // ── Wire AgentBridge events → WebSocket + Sync log ──

  agent.on('log', ({ taskId, log }) => {
    broadcast({ type: 'task:log', taskId, log })
    // Also publish to sync log so desktop clients see it
    sync.publishEvent('task_log_append', 'task', taskId, [log])
  })

  agent.on('status', ({ taskId, status }) => {
    broadcast({ type: 'task:status', taskId, status })
    sync.publishEvent('task_status', 'task', taskId, { status })
  })

  agent.on('permission', ({ taskId, id, text, format }) => {
    broadcast({
      type: 'permission:request',
      taskId,
      id,
      text,
      format,
    })
  })

  console.log('[WS] Sync channel ready at /ws/sync')
}

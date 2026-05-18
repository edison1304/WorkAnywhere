// Node 16 polyfill: DataStore uses global crypto.randomUUID()
import { webcrypto } from 'crypto'
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto

import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { homedir } from 'os'
import { join } from 'path'

import { DataStore, FsPersistence } from '../../../electron/main/services/DataStore'
import { GatewaySync } from './services/GatewaySync'
import { AgentBridge } from './services/AgentBridge'
import { ensureToken, tokenAuth } from './auth/tokenAuth'
import { projectRoutes } from './routes/projects'
import { phaseRoutes } from './routes/phases'
import { taskRoutes } from './routes/tasks'
import { setupSyncChannel } from './ws/syncChannel'

const PORT = parseInt(process.env.GATEWAY_PORT || '3847', 10)
const HOST = process.env.GATEWAY_HOST || '0.0.0.0'
const DATA_PATH = join(homedir(), '.workanywhere', 'data.json')

// ── Initialize services ──

const persistence = new FsPersistence(DATA_PATH)
const dataStore = new DataStore(persistence)
dataStore.load()

const sync = new GatewaySync()
sync.initialize()

const agent = new AgentBridge()
const token = ensureToken()

// Wire agent events → DataStore persistence
agent.on('log', ({ taskId, log }) => {
  dataStore.taskAddLog(taskId, log)
})

agent.on('status', ({ taskId, status }) => {
  dataStore.taskUpdate(taskId, { status })
})

// ── Express app ──

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))

// Auth middleware for /api routes
app.use('/api', tokenAuth(token))

// REST routes
app.use('/api/projects', projectRoutes(dataStore, sync))
app.use('/api/phases', phaseRoutes(dataStore, sync))
app.use('/api/tasks', taskRoutes(dataStore, sync, agent))

// Data load endpoint
app.get('/api/data', (_req, res) => {
  const data = dataStore.getAll()
  res.json({ success: true, data })
})

// Health check (no auth)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', seq: sync.currentSeq })
})

// ── Serve mobile PWA (static files from mobile-web/dist) ──
const MOBILE_DIST = join(__dirname, '..', '..', 'mobile-web', 'dist')
app.use(express.static(MOBILE_DIST))
// SPA fallback: serve index.html for all non-API routes
app.get('*', (_req, res) => {
  res.sendFile(join(MOBILE_DIST, 'index.html'))
})

// ── HTTP + WebSocket server ──

const server = createServer(app)
setupSyncChannel(server, sync, agent, token)

server.listen(PORT, HOST, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║  WorkAnywhere Gateway                        ║
║  http://${HOST}:${PORT}                      ║
║                                              ║
║  Token: ${token.slice(0, 8)}...              ║
║  Data:  ${DATA_PATH}                         ║
║  Seq:   ${sync.currentSeq}                   ║
╚══════════════════════════════════════════════╝
`)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Gateway] Shutting down...')
  sync.stop()
  server.close()
  process.exit(0)
})

process.on('SIGINT', () => {
  console.log('[Gateway] Interrupted, shutting down...')
  sync.stop()
  server.close()
  process.exit(0)
})

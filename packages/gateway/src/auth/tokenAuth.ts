import { readFileSync, writeFileSync, existsSync } from 'fs'
import { randomBytes } from 'crypto'
import { homedir } from 'os'
import { join } from 'path'
import type { Request, Response, NextFunction } from 'express'

const TOKEN_PATH = join(homedir(), '.workanywhere', '.gateway-token')

/** Generate a token if none exists, return the current token. */
export function ensureToken(): string {
  if (existsSync(TOKEN_PATH)) {
    return readFileSync(TOKEN_PATH, 'utf-8').trim()
  }
  const token = randomBytes(32).toString('hex')
  writeFileSync(TOKEN_PATH, token, { mode: 0o600 })
  console.log(`[Auth] Generated gateway token at ${TOKEN_PATH}`)
  return token
}

/** Express middleware: verify Bearer token on all /api and /ws routes. */
export function tokenAuth(token: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Allow WebSocket upgrade requests — token checked in ws handler
    if (req.headers.upgrade === 'websocket') {
      next()
      return
    }

    const auth = req.headers.authorization
    if (!auth || !auth.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'Missing Authorization header' })
      return
    }

    const provided = auth.slice(7)
    if (provided !== token) {
      res.status(403).json({ success: false, error: 'Invalid token' })
      return
    }

    next()
  }
}

/** Verify token from WebSocket URL query param or header. */
export function verifyWsToken(token: string, req: { url?: string; headers: Record<string, string | undefined> }): boolean {
  // Check query param: /ws/sync?token=xxx
  const url = new URL(req.url || '/', 'http://localhost')
  const qToken = url.searchParams.get('token')
  if (qToken === token) return true

  // Check header
  const auth = req.headers.authorization
  if (auth && auth.startsWith('Bearer ') && auth.slice(7) === token) return true

  return false
}

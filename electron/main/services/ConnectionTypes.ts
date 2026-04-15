// Shared types for SSHService and LocalService

export interface ClaudeStreamEvent {
  type: string
  content?: string | unknown[]
  tool?: string
  input?: Record<string, unknown>
  output?: string
  error?: string
  session_id?: string
  result?: string
  [key: string]: unknown
}

export interface StreamHandle {
  onEvent: (cb: (event: ClaudeStreamEvent) => void) => void
  onClose: (cb: (code: number) => void) => void
  kill: () => void
}

export interface ISession {
  id: string
  onData: (cb: (data: string) => void) => void
  onClose: (cb: () => void) => void
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  close: () => void
}

export interface IConnectionService {
  getShellPrefix(engine?: string): string
  getEngineCmd(engine: string, extraArgs: string[]): string
  spawnAgentStream(engine: string, workspacePath: string, prompt: string, sessionId: string): Promise<StreamHandle>
  spawnPTY(command: string, sessionId: string, cols?: number, rows?: number): Promise<ISession>
  exec(command: string, useLogin?: boolean): Promise<string>
  isConnected(): boolean
  checkClaude(): Promise<{ available: boolean; version?: string }>
}

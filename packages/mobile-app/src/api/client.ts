import type {
  Project, Phase, Task, CreateProjectInput, SavedData,
  LogEntry, Artifact, Plan, SyncEvent, TaskStatus,
} from '@shared/types'
import type { WsServerEvent, WsClientEvent } from '@shared/apiContract'

/**
 * GatewayClient — typed HTTP + WebSocket client for the WorkAnywhere API Gateway.
 */
export class GatewayClient {
  private wsConnection: WebSocket | null = null
  private eventListeners = new Map<string, Set<(data: any) => void>>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private baseUrl: string,
    private token: string,
  ) {}

  // ─── REST helpers ───

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const json = await res.json()
    if (!res.ok || json.success === false) {
      throw new Error(json.error || `HTTP ${res.status}`)
    }
    return json.data !== undefined ? json.data : json
  }

  private get<T>(path: string) { return this.request<T>('GET', path) }
  private post<T>(path: string, body?: unknown) { return this.request<T>('POST', path, body) }
  private put<T>(path: string, body?: unknown) { return this.request<T>('PUT', path, body) }
  private del<T>(path: string) { return this.request<T>('DELETE', path) }

  // ─── Project CRUD ───
  projectList() { return this.get<Project[]>('/api/projects') }
  projectCreate(input: CreateProjectInput) { return this.post<Project>('/api/projects', input) }
  projectUpdate(id: string, patch: Partial<Project>) { return this.put<Project>(`/api/projects/${id}`, patch) }
  projectDelete(id: string) { return this.del<void>(`/api/projects/${id}`) }

  // ─── Phase CRUD ───
  phaseList(projectId: string) { return this.get<Phase[]>(`/api/phases?projectId=${projectId}`) }
  phaseCreate(projectId: string, name: string, description?: string) {
    return this.post<Phase>('/api/phases', { projectId, name, description })
  }
  phaseUpdate(id: string, patch: Partial<Phase>) { return this.put<Phase>(`/api/phases/${id}`, patch) }
  phaseDelete(id: string) { return this.del<void>(`/api/phases/${id}`) }

  // ─── Task CRUD ───
  taskList(phaseId: string) { return this.get<Task[]>(`/api/tasks?phaseId=${phaseId}`) }
  taskCreate(phaseId: string, name: string, purpose: string, prompt: string) {
    return this.post<Task>('/api/tasks', { phaseId, name, purpose, prompt })
  }
  taskUpdate(id: string, patch: Partial<Task>) { return this.put<Task>(`/api/tasks/${id}`, patch) }
  taskDelete(id: string) { return this.del<void>(`/api/tasks/${id}`) }

  // ─── Agent interaction ───
  taskRun(taskId: string) { return this.post<void>(`/api/tasks/${taskId}/run`) }
  taskStop(taskId: string) { return this.post<void>(`/api/tasks/${taskId}/stop`) }
  taskSend(taskId: string, message: string) {
    return this.post<void>(`/api/tasks/${taskId}/send`, { message })
  }
  taskRespondPermission(taskId: string, approved: boolean, format: 'numbered' | 'yn') {
    return this.post<void>(`/api/tasks/${taskId}/permission`, { approved, format })
  }

  // ─── Data ───
  dataLoad() { return this.get<SavedData>('/api/data') }

  // ─── WebSocket ───
  connectSync(lastSeq: number): void {
    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + `/ws/sync?token=${this.token}`
    this.wsConnection = new WebSocket(wsUrl)

    this.wsConnection.onopen = () => {
      const msg: WsClientEvent = { type: 'subscribe', lastSeq }
      this.wsConnection?.send(JSON.stringify(msg))
      this.emitLocal('connected', null)
    }

    this.wsConnection.onmessage = (e) => {
      try {
        const event: WsServerEvent = JSON.parse(typeof e.data === 'string' ? e.data : '')
        this.emitLocal(event.type, event)
      } catch { /* ignore */ }
    }

    this.wsConnection.onclose = () => {
      this.emitLocal('disconnected', null)
      this.reconnectTimer = setTimeout(() => this.connectSync(lastSeq), 3000)
    }

    this.wsConnection.onerror = () => {
      this.wsConnection?.close()
    }
  }

  disconnectSync(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.wsConnection?.close()
    this.wsConnection = null
  }

  on(eventType: string, cb: (data: any) => void): () => void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set())
    }
    this.eventListeners.get(eventType)!.add(cb)
    return () => this.eventListeners.get(eventType)?.delete(cb)
  }

  private emitLocal(type: string, data: any): void {
    const listeners = this.eventListeners.get(type)
    if (listeners) {
      for (const cb of listeners) cb(data)
    }
  }
}

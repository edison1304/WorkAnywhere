// ─── 대분류: Project ───
export interface Project {
  id: string
  name: string
  workspacePath: string
  connection: ConnectionConfig
  settings: ProjectSettings
  createdAt: string
  updatedAt: string
}

export interface ConnectionConfig {
  type: 'local' | 'ssh'
  ssh?: {
    host: string
    port: number
    username: string
    authMethod: 'key' | 'password' | 'agent'
    keyPath?: string
  }
}

export interface ProjectSettings {
  claudeMdPath?: string
  defaultBranch?: string
  autoArtifactScan: boolean
}

// ─── 중분류: Phase ───
export interface Phase {
  id: string
  projectId: string
  name: string
  description?: string
  order: number
  status: PhaseStatus
  createdAt: string
  updatedAt: string
}

export type PhaseStatus = 'active' | 'paused' | 'completed'

// ─── 소분류: Task ───
export interface Task {
  id: string
  phaseId: string
  projectId: string
  name: string
  status: TaskStatus
  sessionId?: string
  prompt: string
  logs: LogEntry[]
  artifacts: Artifact[]
  acknowledgedAt?: string    // 사용자가 결과를 확인한 시각
  createdAt: string
  updatedAt: string
  completedAt?: string
}

export type TaskStatus =
  | 'idle'        // 에이전트 미호출
  | 'queued'      // 대기 중
  | 'running'     // 에이전트 실행 중
  | 'waiting'     // 사용자 입력 대기
  | 'completed'   // 완료 (에이전트 종료, 로그 보존)
  | 'failed'      // 실패 (에이전트 종료, 로그 보존)

// ─── Log ───
export interface LogEntry {
  id: string
  taskId: string
  timestamp: string
  type: 'agent_start' | 'tool_call' | 'text' | 'error' | 'agent_end'
  content: string
  meta?: {
    tool?: string
    duration?: number
  }
}

// ─── Artifact ───
export interface Artifact {
  id: string
  taskId: string
  filePath: string
  type: ArtifactType
  action: 'created' | 'modified' | 'deleted'
  detectedAt: string
}

export type ArtifactType =
  | 'code' | 'markdown' | 'yaml' | 'json'
  | 'image' | 'pdf' | 'text' | 'other'

// ─── IPC ───
export interface IpcApi {
  // Project (대분류)
  projectList(): Promise<Project[]>
  projectCreate(input: CreateProjectInput): Promise<Project>
  projectDelete(id: string): Promise<void>

  // Phase (중분류)
  phaseList(projectId: string): Promise<Phase[]>
  phaseCreate(projectId: string, name: string, description?: string): Promise<Phase>
  phaseUpdate(id: string, patch: Partial<Phase>): Promise<Phase>
  phaseDelete(id: string): Promise<void>

  // Task (소분류)
  taskList(phaseId: string): Promise<Task[]>
  taskCreate(phaseId: string, name: string, prompt: string): Promise<Task>
  taskRun(taskId: string): Promise<void>        // 에이전트 호출
  taskSend(taskId: string, message: string): Promise<void>
  taskStop(taskId: string): Promise<void>        // 에이전트 종료

  // Events (Main → Renderer)
  onTaskStatus(cb: (data: { taskId: string; status: TaskStatus }) => void): () => void
  onTaskLog(cb: (data: { taskId: string; log: LogEntry }) => void): () => void
  onArtifactNew(cb: (data: { taskId: string; artifact: Artifact }) => void): () => void
}

export interface CreateProjectInput {
  name: string
  workspacePath: string
  connection: ConnectionConfig
}

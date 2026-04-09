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
    password?: string
  }
}

export type AgentEngine = 'claude' | 'opencode'

export interface ProjectSettings {
  agentEngine: AgentEngine          // 'claude' or 'opencode'
  claudeMdPath?: string
  defaultBranch?: string
  autoArtifactScan: boolean
}

export interface EngineConfig {
  claude: {
    command: string
    args: string[]
    setupScript: string
  }
  opencode: {
    command: string
    args: string[]
    setupScript: string
    provider?: string               // e.g. 'anthropic', 'openai', 'google'
  }
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
  pinned?: boolean           // 핀 고정 — monitor에서 영구 표시
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

  // Window management (dual monitor)
  windowDetach(panelId: string, options: DetachOptions): Promise<{ success: boolean; reused?: boolean }>
  windowReattach(panelId: string): Promise<{ success: boolean }>
  windowListDetached(): Promise<string[]>
  onWindowReattached(cb: (panelId: string) => void): () => void

  // State sync between windows
  syncState(data: unknown): void
  onStateSync(cb: (data: unknown) => void): () => void

  // Desktop notifications
  sendNotification(options: NotifyOptions): Promise<{ success: boolean }>

  // Focus main window (from detached)
  focusMain(): Promise<{ success: boolean }>

  // SSH connection
  sshConnect(config: ConnectionConfig, appConfig?: AppConfig): Promise<{ success: boolean; claude?: { available: boolean; version?: string }; error?: string }>
  sshUpdateEngineConfig(appConfig: AppConfig): Promise<{ success: boolean }>
  sshDisconnect(): Promise<{ success: boolean }>
  sshStatus(): Promise<{ connected: boolean }>
  sshExec(command: string): Promise<{ success: boolean; output?: string; error?: string }>

  // Agent control
  agentStart(opts: { projectId: string; phaseId: string; taskId: string; workspacePath: string; prompt: string; engine?: AgentEngine }): Promise<{ success: boolean; error?: string }>
  agentStop(taskId: string): Promise<{ success: boolean }>
  agentSend(taskId: string, message: string): Promise<{ success: boolean }>

  // PTY I/O (for xterm.js)
  ptyWrite(taskId: string, data: string): void
  ptyResize(taskId: string, cols: number, rows: number): void
  onPtyData(cb: (data: { taskId: string; data: string }) => void): () => void

  // Workspace management
  workspaceLoad(): Promise<{ success: boolean; workspace?: unknown; error?: string }>
  workspaceSave(workspace: unknown): Promise<{ success: boolean; error?: string }>

  // Local config (saved connection settings)
  configLoad(): Promise<{ success: boolean; config: AppConfig | null }>
  configSave(config: AppConfig): Promise<{ success: boolean }>

  // Data persistence
  dataLoad(): Promise<{ success: boolean; data: SavedData | null }>
  dataSave(data: SavedData): Promise<{ success: boolean }>

  // Remote folder browser
  sshListDir(path: string): Promise<{ success: boolean; entries?: DirEntry[]; currentPath?: string; error?: string }>
  sshMkdir(path: string): Promise<{ success: boolean; error?: string }>
  sshHome(): Promise<{ success: boolean; home?: string; error?: string }>

  // Window info
  getWindowHash(): string
}

export interface DetachOptions {
  title?: string
  width?: number
  height?: number
  preferSecondary?: boolean   // true → 두 번째 모니터에 배치
}

export interface NotifyOptions {
  title: string
  body: string
  urgency?: 'low' | 'normal' | 'critical'
}

export interface AppConfig {
  host?: string
  port?: number
  username?: string
  authMethod?: 'key' | 'password' | 'agent'
  keyPath?: string
  // Custom claude execution
  claudeCommand?: string
  claudeArgs?: string[]
  claudeEnv?: Record<string, string>
  claudeSetupScript?: string
  // Custom opencode execution
  opencodeCommand?: string          // e.g. "opencode" or full path
  opencodeArgs?: string[]
  opencodeSetupScript?: string
}

export interface DirEntry {
  name: string
  isDir: boolean
  path: string
}

export interface SavedData {
  projects: Project[]
  phases: Phase[]
  tasks: Task[]
}

export interface CreateProjectInput {
  name: string
  workspacePath: string
  connection: ConnectionConfig
}

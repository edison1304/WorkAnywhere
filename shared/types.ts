// ─── 대분류: Project ───
export interface Project {
  id: string
  name: string
  workspacePath: string
  connection: ConnectionConfig
  settings: ProjectSettings
  summary?: ProjectSummary
  createdAt: string
  updatedAt: string
}

export interface ProjectSummary {
  pipeline: string            // 전체 파이프라인 흐름 (e.g. "전처리 → 학습 → 평가")
  currentPhase: string        // 현재 진행 중인 단계
  overallProgress: string     // 전체 진행 요약
  blockers: string[]          // 프로젝트 레벨 블로커
  updatedAt: string
}

export interface ConnectionConfig {
  type: 'local' | 'ssh' | 'remote'
  ssh?: {
    host: string
    port: number
    username: string
    authMethod: 'key' | 'password' | 'agent'
    keyPath?: string
    password?: string
  }
  remote?: {
    link: string            // Claude Remote Control link/URL
    label?: string          // 사용자 지정 라벨 (e.g. "GPU Server Main Claude")
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
  summary?: PhaseSummary
  createdAt: string
  updatedAt: string
}

export interface PhaseSummary {
  pipeline: string            // 로컬 파이프라인 (e.g. "디버깅 → 오류수정 → 재검토")
  currentState: string        // 현재 상태 요약
  completedWork: string[]     // 완료된 작업들
  pendingWork: string[]       // 남은 작업들
  issues: string[]            // 현재 문제점
  dependencies: string[]      // 태스크 간 의존성 (e.g. "A 완료 후 B 실행 가능")
  updatedAt: string
}

export type PhaseStatus = 'active' | 'paused' | 'completed'

// ─── 소분류: Task ───
export interface Task {
  id: string
  phaseId: string
  projectId: string
  name: string
  purpose: string             // 이 태스크의 본래 목적/목표
  status: TaskStatus
  sessionId?: string
  prompt: string
  logs: LogEntry[]
  artifacts: Artifact[]
  summary?: TaskSummary       // Claude CLI로 생성된 요약
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
  | 'review'      // 완료 후 사용자 검토 필요
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

// ─── Task Summary (Claude API 기반 요약) ───
export interface TaskSummary {
  currentStep: string         // 현재 진행 중인 단계
  completedSteps: string[]    // 완료된 단계들
  nextSteps: string[]         // 예상 다음 단계
  issues: string[]            // 발견된 문제/에러
  progress: string            // 전체 진행 요약 (한 줄)
  updatedAt: string
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
  projectUpdate(id: string, patch: Partial<Project>): Promise<Project | null>
  projectDelete(id: string): Promise<void>

  // Phase (중분류)
  phaseList(projectId: string): Promise<Phase[]>
  phaseCreate(projectId: string, name: string, description?: string): Promise<Phase>
  phaseUpdate(id: string, patch: Partial<Phase>): Promise<Phase | null>
  phaseDelete(id: string): Promise<void>

  // Task (소분류)
  taskList(phaseId: string): Promise<Task[]>
  taskCreate(phaseId: string, name: string, purpose: string, prompt: string): Promise<Task>
  taskUpdate(id: string, patch: Partial<Task>): Promise<Task | null>
  taskDelete(id: string): Promise<void>
  taskRun(taskId: string): Promise<{ success: boolean; error?: string }>
  taskSend(taskId: string, message: string): Promise<{ success: boolean }>
  taskStop(taskId: string): Promise<{ success: boolean }>

  // Events (Main → Renderer)
  onTaskStatus(cb: (data: { taskId: string; status: TaskStatus }) => void): () => void
  onTaskLog(cb: (data: { taskId: string; log: LogEntry }) => void): () => void
  onArtifactNew(cb: (data: { taskId: string; artifact: Artifact }) => void): () => void
  onConnectionStatus(cb: (data: { key: string; status: 'lost' | 'reconnecting' | 'restored' | 'failed'; attempt?: number; maxRetries?: number; projectIds?: string[] }) => void): () => void

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

  // Connection (per-project)
  projectConnect(projectId: string, appConfig?: AppConfig): Promise<{ success: boolean; claude?: { available: boolean; version?: string }; error?: string }>
  projectDisconnect(projectId: string): Promise<{ success: boolean }>

  // Connection (legacy / browse mode)
  localConnect(appConfig?: AppConfig): Promise<{ success: boolean; claude?: { available: boolean; version?: string }; error?: string }>
  sshConnect(config: ConnectionConfig, appConfig?: AppConfig): Promise<{ success: boolean; claude?: { available: boolean; version?: string }; error?: string }>
  remoteConnect(remoteLink: string, appConfig?: AppConfig): Promise<{ success: boolean; claude?: { available: boolean; version?: string }; error?: string }>
  sshUpdateEngineConfig(appConfig: AppConfig): Promise<{ success: boolean }>
  sshDisconnect(): Promise<{ success: boolean }>
  sshStatus(): Promise<{ connected: boolean }>
  sshExec(command: string): Promise<{ success: boolean; output?: string; error?: string }>

  // Agent control
  agentStart(opts: { projectId: string; phaseId: string; taskId: string; workspacePath: string; prompt: string; engine?: AgentEngine }): Promise<{ success: boolean; error?: string }>
  agentStop(taskId: string): Promise<{ success: boolean }>
  agentResume(taskId: string): Promise<{ success: boolean; error?: string }>
  agentSend(taskId: string, message: string): Promise<{ success: boolean }>

  // PTY I/O (for xterm.js)
  ptyWrite(taskId: string, data: string): void
  ptyResize(taskId: string, cols: number, rows: number): void
  onPtyData(cb: (data: { taskId: string; data: string }) => void): () => void
  onPtyClose(cb: (data: { taskId: string }) => void): () => void

  // Workspace management
  workspaceLoad(): Promise<{ success: boolean; workspace?: unknown; error?: string }>
  workspaceSave(workspace: unknown): Promise<{ success: boolean; error?: string }>

  // Local config (saved connection settings)
  configLoad(): Promise<{ success: boolean; config: AppConfig | null }>
  configSave(config: AppConfig): Promise<{ success: boolean }>

  // Data persistence
  dataLoad(): Promise<{ success: boolean; data: SavedData | null }>
  dataSave(data: SavedData): Promise<{ success: boolean }>

  // Remote file read
  sshReadFile(filePath: string): Promise<{ success: boolean; content?: string; encoding?: 'utf8' | 'base64'; size?: number; error?: string }>

  // Remote folder browser
  sshUploadFile(opts: { fileName: string; data: number[]; workspacePath: string }): Promise<{ success: boolean; remotePath?: string; error?: string }>
  sshListDir(path: string): Promise<{ success: boolean; entries?: DirEntry[]; currentPath?: string; error?: string }>
  sshMkdir(path: string): Promise<{ success: boolean; error?: string }>
  sshHome(): Promise<{ success: boolean; home?: string; error?: string }>

  // Summarize (Claude CLI)
  taskSummarize(taskId: string): Promise<{ success: boolean; summary?: TaskSummary; error?: string }>
  phaseSummarize(phaseId: string): Promise<{ success: boolean; summary?: PhaseSummary; error?: string }>
  projectSummarize(projectId: string): Promise<{ success: boolean; summary?: ProjectSummary; error?: string }>

  // Session Descriptor
  descriptorExport(projectId: string): Promise<{ success: boolean; descriptor?: SessionDescriptor; error?: string }>
  descriptorImport(descriptor: SessionDescriptor): Promise<{ success: boolean; projectId?: string; error?: string }>

  // Window info
  setWindowTitle(title: string): void
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

// ─── Session Descriptor (export/import) ───
export interface SessionDescriptor {
  version: 1
  exportedAt: string
  exportedFrom: string    // hostname
  project: {
    name: string
    workspacePath: string
    connection: ConnectionConfig
    settings: ProjectSettings
  }
  phases: Array<{
    name: string
    description?: string
    order: number
    status: PhaseStatus
  }>
  tasks: Array<{
    phaseName: string     // reference by name for portability
    name: string
    purpose: string
    prompt: string
    status: TaskStatus
    sessionId?: string
  }>
}

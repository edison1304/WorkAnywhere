// ─── 대분류: Project ───
export interface Project {
  id: string
  name: string
  workspacePath: string
  connection: ConnectionConfig
  settings: ProjectSettings
  summary?: ProjectSummary
  /** Top-level plan — vision + milestones. Optional. */
  plan?: Plan
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
  /** Mid-level plan (shorter than Project, broader than Task). Optional. */
  plan?: Plan
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

// ─── Intent Lock (작업의 북극성) ───
// 사용자가 작업의 범위를 의도적으로 좁혀 AI가 산으로 가는 것을 막는다.
// purpose가 "무엇을 할 것인가"라면, intentLock은 "무엇을 하지 말 것인가" + "끝났는지 어떻게 알 것인가".
export interface IntentLock {
  mustNotTouch?: string[]      // 건드리면 안 되는 것 (예: "전체 인증 리팩토링", "OAuth 확장")
  successCriteria?: string     // 성공 기준 (예: "로컬 환경에서 로그인 성공/실패 흐름 검증")
}

// ─── 소분류: Task ───
export interface Task {
  id: string
  phaseId: string
  projectId: string
  name: string
  purpose: string             // 이 태스크의 본래 목적/목표
  intentLock?: IntentLock     // 범위 잠금 — 본목적 고정 영역(Intent Lock)에서 표시
  order: number              // 같은 phase 내 정렬 순서
  status: TaskStatus
  sessionId?: string
  prompt: string
  logs: LogEntry[]
  artifacts: Artifact[]
  summary?: TaskSummary       // Claude CLI로 생성된 요약
  acknowledgedAt?: string    // 사용자가 결과를 확인한 시각
  pinned?: boolean           // 핀 고정 — monitor에서 영구 표시

  // ─── Scheduling signals (Schedule 페이지에서 사용) ───
  // 사용자가 Schedule 페이지 토글로 오버라이드한 값. unset이면 휴리스틱으로 추정.
  interactionLevel?: InteractionLevel  // 사용자 간섭 정도
  weightHint?: WeightHint              // 자원/시간 무게

  // ─── Plan (auto-extracted from agent output, optional) ───
  plan?: Plan

  /** Compacted session — produced when user marks task complete. Drives Timeline. */
  compacted?: CompactedSession

  createdAt: string
  updatedAt: string
  completedAt?: string
}

export type InteractionLevel = 'autonomous' | 'mixed' | 'interactive'
export type WeightHint = 'light' | 'normal' | 'heavy'

// ─── Plan / Checklist / JudgmentLog (per-entity context structuring) ───
//
// Optional structured plan attached to a task / phase / project. Purpose:
// give the agent a stable mental model so it doesn't re-derive context every
// turn, and give the user a glanceable progress signal.
// Auto-extracted from agent output (regex-parse) — never required, never
// blocking. UI surfaces them when present, stays quiet when absent.

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
  doneAt?: string
}

export interface JudgmentEntry {
  timestamp: string
  decision: string   // one line
  reason: string     // one line
}

export interface Plan {
  /** Markdown paragraph — what / why / how at a glance. */
  design: string
  /** Ordered checkbox steps; progress = done / total. */
  checklist: ChecklistItem[]
  /** Decision log accumulated during execution. */
  judgmentLog: JudgmentEntry[]
  /** Optional retrospective written after completion. */
  retrospective?: string
  generatedAt: string
  updatedAt: string
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

// ─── Compacted Session (timeline-friendly compaction of task.logs) ───
// Produced by the LLM when user completes a task. Drives the Timeline view:
// each bucket maps to one of the 3 columns (완료 / 우회 / 에러).
export interface CompactedSession {
  compactedAt: string
  focusInstructions?: string   // user-provided focus, if any
  headline: string             // one-line "what this task was about"
  completed: CompletedItem[]   // 🟢 무엇이 완료되었나
  detours:   DetourItem[]      // 🟡 계획과 달라진 지점 + 이유
  errors:    ErrorItem[]       // 🔴 무슨 문제 + 왜 + 어떻게 해결
}

export interface CompletedItem {
  id: string
  timestamp?: string
  title: string
  detail?: string
  refs?: { files?: string[]; commits?: string[] }
}

export interface DetourItem {
  id: string
  timestamp?: string
  title: string
  reason: string
  refs?: { files?: string[] }
}

export interface ErrorItem {
  id: string
  timestamp?: string
  title: string
  cause: string
  fix: string                  // "미해결" if unresolved
  refs?: { files?: string[]; commits?: string[] }
}

// ─── Task Summary (Claude API 기반 요약) ───
//
// 두 종류의 필드가 공존한다.
//
//   1) "체크리스트적" 필드 (currentStep / completedSteps / nextSteps / issues / progress)
//      — 시간순 진행 상태. 기존 InsightPanel / summaryPanel 가 사용.
//
//   2) "판단 흐름적" 필드 (problem / cause / response / reason / residualRisk
//      / humanNeeded / nextPrompt)
//      — work_anywhere_context_summary_ui.md §5/§12 의 사건 카드 구조.
//      EventCard / Auto Prompt Panel 이 사용. 모두 optional.
//
// 같은 요약 1회 호출에서 둘 다 채워진다. 점진 마이그레이션 후 (1) 제거 예정.
export interface TaskSummary {
  // ─── (1) Checklist-shaped (legacy, required) ───
  currentStep: string         // 현재 진행 중인 단계
  completedSteps: string[]    // 완료된 단계들
  nextSteps: string[]         // 예상 다음 단계
  issues: string[]            // 발견된 문제/에러
  progress: string            // 전체 진행 요약 (한 줄)

  // ─── (2) Event-shaped (new, optional) ───
  problem?: string            // 문제 — 막히거나 우회한 것
  cause?: string              // 원인 판단 — AI가 본 원인
  response?: string           // 대응 — 무엇을 했는지
  reason?: string             // 이유 — 왜 그 대응을 택했는지
  residualRisk?: string       // 남은 위험 — 임시방편이거나 미해결인 부분
  humanNeeded?: string        // 사람 개입 필요 — 사람이 한 번 봐주면 효율 폭증할 지점
  nextPrompt?: string         // 다음 프롬프트 — AI에게 바로 줄 수 있는 고품질 지시문

  // ─── (3) Semantic drift / alignment (work_anywhere_context_summary_ui.md §15.4) ───
  // 토큰 사용량 기반의 calcDrift 와는 별도. 이쪽은 "AI가 본목적/IntentLock 에 비해
  // 얼마나 정렬되어 있는가" 를 LLM 이 판단해서 채운다.
  alignment?: AlignmentLevel  // 'aligned' | 'mild-drift' | 'severe-drift'
  alignmentScore?: number     // 0~100 (100 = 완전 정렬, 0 = 완전 이탈)
  alignmentReason?: string    // 한 문장 — 왜 그 등급인지 (예: "목표는 버그 수정이었으나 인증 리팩토링으로 확장 중")

  updatedAt: string
}

export type AlignmentLevel = 'aligned' | 'mild-drift' | 'severe-drift'

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
  onTaskPlan(cb: (data: { taskId: string; plan: Plan }) => void): () => void
  onArtifactNew(cb: (data: { taskId: string; artifact: Artifact }) => void): () => void
  onConnectionStatus(cb: (data: { key: string; status: 'lost' | 'reconnecting' | 'restored' | 'failed' | 'healthy'; attempt?: number; maxRetries?: number; projectIds?: string[]; ts?: number }) => void): () => void

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

  // Permission approval (PTY-detected prompts)
  taskRespondPermission(taskId: string, approved: boolean, format: 'numbered' | 'yn'): Promise<{ success: boolean; error?: string }>
  onTaskPermissionRequest(cb: (data: { taskId: string; id: string; text: string; format: 'numbered' | 'yn' }) => void): () => void

  // PTY I/O (for xterm.js)
  ptyWrite(taskId: string, data: string): void
  ptyResize(taskId: string, cols: number, rows: number): void
  onPtyData(cb: (data: { taskId: string; data: string }) => void): () => void
  onPtyClose(cb: (data: { taskId: string }) => void): () => void

  // Shell terminal (server bash, not claude)
  shellOpen(projectId: string): Promise<{ success: boolean; shellId?: string; error?: string }>
  shellWrite(shellId: string, data: string): void
  shellResize(shellId: string, cols: number, rows: number): void
  shellClose(shellId: string): Promise<{ success: boolean }>
  onShellData(cb: (data: { shellId: string; data: string }) => void): () => void
  onShellClose(cb: (data: { shellId: string }) => void): () => void

  // Workspace management
  workspaceLoad(): Promise<{ success: boolean; workspace?: unknown; error?: string }>
  workspaceSave(workspace: unknown): Promise<{ success: boolean; error?: string }>

  // Local config (saved connection settings)
  configLoad(): Promise<{ success: boolean; config: AppConfig | null }>
  configSave(config: AppConfig): Promise<{ success: boolean }>

  // Data persistence
  dataLoad(): Promise<{ success: boolean; data: SavedData | null }>
  dataSave(data: SavedData): Promise<{ success: boolean }>
  dataSaveToServer(): Promise<{ success: boolean; error?: string }>
  dataLoadFromServer(): Promise<{ success: boolean; data: SavedData | null; error?: string }>

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

  // Compact (Timeline용 — 완료 시점에 task.logs를 3-bucket으로 정리)
  taskCompact(taskId: string, focusInstructions?: string): Promise<{ success: boolean; compacted?: CompactedSession; error?: string }>

  // Reorder
  taskReorder(phaseId: string, orderedIds: string[]): Promise<{ success: boolean }>
  phaseReorder(projectId: string, orderedIds: string[]): Promise<{ success: boolean }>

  // Schedule (CPU-style nice ordering + LLM split)
  scheduleCompute(projectId: string): Promise<{ success: boolean; result?: ScheduleResult; error?: string }>

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

// ─── Schedule (CPU-style ordering for Schedule page) ───
export interface ScheduledTask {
  taskId: string
  nice: number                          // lower = run sooner
  interactionLevel: InteractionLevel    // resolved (override or heuristic)
  weightHint: WeightHint                // resolved
  reason?: string                       // short human reason from LLM, optional
  inferred: { interaction: boolean; weight: boolean }  // true = heuristic, false = user override
}

export interface ScheduleResult {
  ordered: ScheduledTask[]              // sorted ascending by nice
  splitIndex: number                    // ordered[splitIndex..] are user-attention. 0 ≤ idx ≤ ordered.length
  splitSource: 'llm' | 'fallback'       // where splitIndex came from
  computedAt: string
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

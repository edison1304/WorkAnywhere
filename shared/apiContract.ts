/**
 * GatewayApi — 모바일 클라이언트가 API Gateway를 통해 사용하는 인터페이스.
 *
 * IpcApi(85+ methods)의 서브셋으로, 채팅 기반 바이브코딩에 필요한 것만 포함.
 * 제외: PTY/Shell 터미널, Monaco 코드 에디터, Window 관리, 파일 브라우저
 */
import type {
  Project,
  Phase,
  Task,
  CreateProjectInput,
  SavedData,
  TaskStatus,
  TaskSummary,
  PhaseSummary,
  ProjectSummary,
  CompactedSession,
  LogEntry,
  Artifact,
  Plan,
  SyncEvent,
  ScheduleResult,
} from './types'

// ─── REST API 요청/응답 타입 ───

export interface ApiResult<T = void> {
  success: boolean
  data?: T
  error?: string
}

// ─── Gateway REST API 계약 ───

export interface GatewayApi {
  // ── Project CRUD ──
  projectList(): Promise<Project[]>
  projectCreate(input: CreateProjectInput): Promise<Project>
  projectUpdate(id: string, patch: Partial<Project>): Promise<Project | null>
  projectDelete(id: string): Promise<void>

  // ── Phase CRUD ──
  phaseList(projectId: string): Promise<Phase[]>
  phaseCreate(projectId: string, name: string, description?: string): Promise<Phase>
  phaseUpdate(id: string, patch: Partial<Phase>): Promise<Phase | null>
  phaseDelete(id: string): Promise<void>

  // ── Task CRUD ──
  taskList(phaseId: string): Promise<Task[]>
  taskCreate(phaseId: string, name: string, purpose: string, prompt: string): Promise<Task>
  taskUpdate(id: string, patch: Partial<Task>): Promise<Task | null>
  taskDelete(id: string): Promise<void>

  // ── Task 실행 제어 ──
  taskRun(taskId: string): Promise<ApiResult>
  taskStop(taskId: string): Promise<ApiResult>
  taskSend(taskId: string, message: string): Promise<ApiResult>

  // ── 에이전트 인터랙션 ──
  agentStart(opts: {
    projectId: string
    phaseId: string
    taskId: string
    workspacePath: string
    prompt: string
  }): Promise<ApiResult>
  agentStop(taskId: string): Promise<ApiResult>
  agentResume(taskId: string): Promise<ApiResult>
  agentSend(taskId: string, message: string): Promise<ApiResult>

  // ── 퍼미션 승인/거부 ──
  taskRespondPermission(
    taskId: string,
    approved: boolean,
    format: 'numbered' | 'yn',
  ): Promise<ApiResult>

  // ── 요약 ──
  taskSummarize(taskId: string): Promise<ApiResult<{ summary?: TaskSummary; compacted?: CompactedSession }>>
  phaseSummarize(phaseId: string): Promise<ApiResult<{ summary?: PhaseSummary }>>
  projectSummarize(projectId: string): Promise<ApiResult<{ summary?: ProjectSummary }>>

  // ── 정렬 ──
  taskReorder(phaseId: string, orderedIds: string[]): Promise<ApiResult>
  phaseReorder(projectId: string, orderedIds: string[]): Promise<ApiResult>

  // ── 스케줄 ──
  scheduleCompute(projectId: string): Promise<ApiResult<{ result?: ScheduleResult }>>

  // ── 데이터 ──
  dataLoad(): Promise<ApiResult<SavedData>>
}

// ─── WebSocket 이벤트 타입 ───

/** Gateway → 모바일: 실시간 이벤트 (WebSocket으로 push) */
export type WsServerEvent =
  | { type: 'sync'; event: SyncEvent }
  | { type: 'task:status'; taskId: string; status: TaskStatus }
  | { type: 'task:log'; taskId: string; log: LogEntry }
  | { type: 'task:plan'; taskId: string; plan: Plan }
  | { type: 'artifact:new'; taskId: string; artifact: Artifact }
  | { type: 'permission:request'; taskId: string; id: string; text: string; format: 'numbered' | 'yn' }
  | { type: 'connection:status'; status: string }

/** 모바일 → Gateway: 클라이언트 메시지 */
export type WsClientEvent =
  | { type: 'subscribe'; lastSeq: number }
  | { type: 'ping' }

// ─── REST 경로 매핑 (타입 안전 참조용) ───

export const API_ROUTES = {
  projects:          '/api/projects',
  phases:            '/api/phases',
  tasks:             '/api/tasks',
  taskRun:           '/api/tasks/:id/run',
  taskStop:          '/api/tasks/:id/stop',
  taskSend:          '/api/tasks/:id/send',
  taskPermission:    '/api/tasks/:id/permission',
  agentStart:        '/api/agent/start',
  agentStop:         '/api/agent/:taskId/stop',
  agentResume:       '/api/agent/:taskId/resume',
  agentSend:         '/api/agent/:taskId/send',
  taskSummarize:     '/api/tasks/:id/summarize',
  phaseSummarize:    '/api/phases/:id/summarize',
  projectSummarize:  '/api/projects/:id/summarize',
  taskReorder:       '/api/tasks/reorder',
  phaseReorder:      '/api/phases/reorder',
  scheduleCompute:   '/api/projects/:id/schedule',
  dataLoad:          '/api/data',
  wsSync:            '/ws/sync',
} as const

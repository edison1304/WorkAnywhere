import { useState, useCallback, useEffect } from 'react'
import { CommandCenter } from './components/layout/CommandCenter'
import { DetachedMonitor } from './components/layout/DetachedMonitor'
import { DetachedStatusRail } from './components/layout/DetachedStatusRail'
import type { Project, Phase, Task } from '../shared/types'
import type { SidebarView } from './components/layout/TreeSidebar'

// ─── Demo Data ───
const DEMO_PROJECTS: Project[] = [
  {
    id: 'p1', name: 'ACE-2 개발',
    workspacePath: '/home/yjlee/ace2',
    connection: { type: 'ssh', ssh: { host: '10.0.0.1', port: 22, username: 'yjlee', authMethod: 'key' } },
    settings: { autoArtifactScan: true },
    createdAt: '2026-04-01T00:00:00Z', updatedAt: '2026-04-09T00:00:00Z'
  },
  {
    id: 'p2', name: 'Workanywhere',
    workspacePath: '/home/yjlee/09./workanywhere',
    connection: { type: 'local' },
    settings: { autoArtifactScan: true },
    createdAt: '2026-04-08T00:00:00Z', updatedAt: '2026-04-09T00:00:00Z'
  }
]

const DEMO_PHASES: Phase[] = [
  // ACE-2 phases
  { id: 'ph1', projectId: 'p1', name: 'AOD 민감도 실험', description: 'Aerosol Optical Depth 파라미터 민감도 분석', order: 1, status: 'active', createdAt: '2026-04-01T00:00:00Z', updatedAt: '2026-04-09T00:00:00Z' },
  { id: 'ph2', projectId: 'p1', name: '모델 경량화', description: 'Quantization 및 경량화 실험', order: 2, status: 'paused', createdAt: '2026-04-03T00:00:00Z', updatedAt: '2026-04-08T00:00:00Z' },
  { id: 'ph3', projectId: 'p1', name: '배포 파이프라인', description: 'vLLM 기반 서빙 파이프라인 구축', order: 3, status: 'active', createdAt: '2026-04-05T00:00:00Z', updatedAt: '2026-04-09T00:00:00Z' },
  // Workanywhere phases
  { id: 'ph4', projectId: 'p2', name: 'MVP 개발', description: 'Electron + React 기본 구조', order: 1, status: 'active', createdAt: '2026-04-08T00:00:00Z', updatedAt: '2026-04-09T00:00:00Z' },
]

const DEMO_TASKS: Task[] = [
  // AOD 민감도 실험
  { id: 't1', phaseId: 'ph1', projectId: 'p1', name: '데이터셋 전처리', status: 'completed', prompt: 'ERA5 데이터 전처리 파이프라인 구축', logs: [
    { id: 'l1', taskId: 't1', timestamp: '2026-04-08T10:00:00Z', type: 'agent_start', content: 'Agent started' },
    { id: 'l2', taskId: 't1', timestamp: '2026-04-08T10:01:00Z', type: 'tool_call', content: 'Read data/era5_raw/', meta: { tool: 'Bash', duration: 2300 } },
    { id: 'l3', taskId: 't1', timestamp: '2026-04-08T10:15:00Z', type: 'text', content: 'ERA5 데이터 전처리 완료. 632개 샘플 생성.' },
    { id: 'l4', taskId: 't1', timestamp: '2026-04-08T10:15:30Z', type: 'agent_end', content: 'Agent terminated successfully' },
  ], artifacts: [], createdAt: '2026-04-08T10:00:00Z', updatedAt: '2026-04-08T10:15:30Z', completedAt: '2026-04-08T10:15:30Z' },
  { id: 't2', phaseId: 'ph1', projectId: 'p1', name: '베이스라인 학습', status: 'running', prompt: 'AOD 예측 베이스라인 모델 학습', logs: [
    { id: 'l5', taskId: 't2', timestamp: '2026-04-09T01:00:00Z', type: 'agent_start', content: 'Agent started' },
    { id: 'l6', taskId: 't2', timestamp: '2026-04-09T01:01:00Z', type: 'tool_call', content: 'python train.py --epochs 100', meta: { tool: 'Bash', duration: 0 } },
  ], artifacts: [], createdAt: '2026-04-09T01:00:00Z', updatedAt: '2026-04-09T01:30:00Z' },
  { id: 't3', phaseId: 'ph1', projectId: 'p1', name: '결과 분석', status: 'idle', prompt: '학습 결과 분석 및 시각화', logs: [], artifacts: [], createdAt: '2026-04-09T00:00:00Z', updatedAt: '2026-04-09T00:00:00Z' },

  // 모델 경량화
  { id: 't4', phaseId: 'ph2', projectId: 'p1', name: 'Quantization 적용', status: 'waiting', prompt: 'FlatQuant W8A8 적용', logs: [
    { id: 'l7', taskId: 't4', timestamp: '2026-04-08T14:00:00Z', type: 'agent_start', content: 'Agent started' },
    { id: 'l8', taskId: 't4', timestamp: '2026-04-08T14:30:00Z', type: 'text', content: 'W8A8 calibration 완료. 평가 진행 여부를 확인해주세요.' },
  ], artifacts: [], createdAt: '2026-04-08T14:00:00Z', updatedAt: '2026-04-08T14:30:00Z' },
  { id: 't5', phaseId: 'ph2', projectId: 'p1', name: '성능 벤치마크', status: 'idle', prompt: 'Quantized 모델 PPL 벤치마크', logs: [], artifacts: [], createdAt: '2026-04-08T00:00:00Z', updatedAt: '2026-04-08T00:00:00Z' },

  // 배포 파이프라인
  { id: 't6', phaseId: 'ph3', projectId: 'p1', name: 'vLLM 빌드', status: 'failed', prompt: 'vLLM 커스텀 휠 빌드', logs: [
    { id: 'l9', taskId: 't6', timestamp: '2026-04-08T16:00:00Z', type: 'agent_start', content: 'Agent started' },
    { id: 'l10', taskId: 't6', timestamp: '2026-04-08T16:20:00Z', type: 'error', content: 'Build failed: CUDA version mismatch (expected 12.1, got 11.7)' },
    { id: 'l11', taskId: 't6', timestamp: '2026-04-08T16:20:05Z', type: 'agent_end', content: 'Agent terminated with error' },
  ], artifacts: [], createdAt: '2026-04-08T16:00:00Z', updatedAt: '2026-04-08T16:20:05Z' },

  // Workanywhere MVP
  { id: 't7', phaseId: 'ph4', projectId: 'p2', name: '3단 계층 구조 구현', status: 'running', prompt: 'Project → Phase → Task 계층 구조 UI 구현', logs: [
    { id: 'l12', taskId: 't7', timestamp: '2026-04-09T02:00:00Z', type: 'agent_start', content: 'Agent started' },
  ], artifacts: [], createdAt: '2026-04-09T02:00:00Z', updatedAt: '2026-04-09T02:30:00Z' },
]

export default function App() {
  // Check if this is a detached window
  const windowHash = typeof window !== 'undefined' && window.api
    ? window.api.getWindowHash() : ''

  const [activeProjectId, setActiveProjectId] = useState<string>('p1')
  const [activePhaseId, setActivePhaseId] = useState<string | null>('ph1')
  const [activeTaskId, setActiveTaskId] = useState<string | null>('t2')
  const [sidebarView, setSidebarView] = useState<SidebarView>('monitor')
  const [tasks, setTasks] = useState<Task[]>(DEMO_TASKS)
  const [detachedPanels, setDetachedPanels] = useState<Set<string>>(new Set())

  const activeProject = DEMO_PROJECTS.find(p => p.id === activeProjectId) || null
  const projectPhases = DEMO_PHASES.filter(ph => ph.projectId === activeProjectId)
  const activePhase = activePhaseId ? DEMO_PHASES.find(ph => ph.id === activePhaseId) || null : null
  const activeTask = activeTaskId ? tasks.find(t => t.id === activeTaskId) || null : null
  const allProjectTasks = tasks.filter(t => t.projectId === activeProjectId)

  // Sync detached panels list
  useEffect(() => {
    if (!window.api) return
    window.api.windowListDetached().then(panels => setDetachedPanels(new Set(panels)))
    const unsub = window.api.onWindowReattached((panelId) => {
      setDetachedPanels(prev => { const n = new Set(prev); n.delete(panelId); return n })
    })
    return unsub
  }, [])

  const handleAcknowledgeTask = useCallback((taskId: string) => {
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, acknowledgedAt: new Date().toISOString() } : t
    ))
  }, [])

  const handlePinTask = useCallback((taskId: string) => {
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, pinned: !t.pinned } : t
    ))
  }, [])

  // Task select from detached window → focus main
  const handleSelectTaskFromDetached = useCallback((taskId: string | null) => {
    setActiveTaskId(taskId)
    if (taskId && window.api) {
      window.api.focusMain()
    }
  }, [])

  const handleDetach = useCallback(async (panelId: string) => {
    if (!window.api) return
    const titles: Record<string, string> = {
      monitor: 'Workanywhere — Monitor',
      statusrail: 'Workanywhere — Status Rail',
    }
    await window.api.windowDetach(panelId, {
      title: titles[panelId] || 'Workanywhere',
      width: panelId === 'monitor' ? 350 : 360,
      height: 800,
      preferSecondary: true,
    })
    setDetachedPanels(prev => new Set(prev).add(panelId))
  }, [])

  const handleReattach = useCallback(async (panelId: string) => {
    if (!window.api) return
    await window.api.windowReattach(panelId)
    setDetachedPanels(prev => { const n = new Set(prev); n.delete(panelId); return n })
  }, [])

  // ─── Detached window renders ───
  if (windowHash === 'monitor') {
    return (
      <DetachedMonitor
        projects={DEMO_PROJECTS}
        phases={DEMO_PHASES}
        allTasks={tasks}
        activeProjectId={activeProjectId}
        activePhaseId={activePhaseId}
        activeTaskId={activeTaskId}
        onSelectProject={setActiveProjectId}
        onSelectPhase={setActivePhaseId}
        onSelectTask={handleSelectTaskFromDetached}
        onAcknowledgeTask={handleAcknowledgeTask}
        onPinTask={handlePinTask}
      />
    )
  }

  if (windowHash === 'statusrail') {
    return (
      <DetachedStatusRail
        allTasks={allProjectTasks}
        phases={projectPhases}
        activeTaskId={activeTaskId}
        onSelectTask={handleSelectTaskFromDetached}
      />
    )
  }

  // ─── Main window ───
  return (
    <CommandCenter
      projects={DEMO_PROJECTS}
      activeProject={activeProject}
      phases={projectPhases}
      allPhases={DEMO_PHASES}
      activePhase={activePhase}
      allTasks={tasks}
      allProjectTasks={allProjectTasks}
      activeTask={activeTask}
      sidebarView={sidebarView}
      detachedPanels={detachedPanels}
      onSidebarViewChange={setSidebarView}
      onSelectProject={(id) => {
        setActiveProjectId(id)
        const firstPhase = DEMO_PHASES.find(ph => ph.projectId === id)
        setActivePhaseId(firstPhase?.id || null)
        setActiveTaskId(null)
      }}
      onSelectPhase={(id) => {
        setActivePhaseId(id)
        setActiveTaskId(null)
      }}
      onSelectTask={setActiveTaskId}
      onAcknowledgeTask={handleAcknowledgeTask}
      onPinTask={handlePinTask}
      onDetach={handleDetach}
      onReattach={handleReattach}
    />
  )
}

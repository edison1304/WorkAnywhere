import { useState } from 'react'
import { CommandCenter } from './components/layout/CommandCenter'
import type { Project, Job } from '../shared/types'

// Demo data for initial UI
const DEMO_PROJECTS: Project[] = [
  {
    id: '1',
    name: 'EXAONE Quantization',
    workspacePath: '/home/yjlee/sota_LGA',
    connection: { type: 'ssh', ssh: { host: '10.0.0.1', port: 22, username: 'yjlee', authMethod: 'key' } },
    settings: { autoArtifactScan: true },
    createdAt: '2026-04-08T00:00:00Z',
    updatedAt: '2026-04-08T00:00:00Z'
  },
  {
    id: '2',
    name: 'Workanywhere App',
    workspacePath: '/home/yjlee/09./workanywhere',
    connection: { type: 'local' },
    settings: { autoArtifactScan: true },
    createdAt: '2026-04-08T00:00:00Z',
    updatedAt: '2026-04-08T00:00:00Z'
  }
]

const DEMO_JOBS: Job[] = [
  {
    id: 'j1', projectId: '1', name: 'FlatQuant W8A8 실험',
    status: 'running', prompt: 'Run FlatQuant W8A8 experiment...', steps: [], artifacts: [],
    createdAt: '2026-04-08T01:00:00Z', updatedAt: '2026-04-08T01:30:00Z'
  },
  {
    id: 'j2', projectId: '1', name: 'GPTAQ 벤치마크 분석',
    status: 'completed', prompt: 'Analyze GPTAQ benchmark results...', steps: [], artifacts: [],
    createdAt: '2026-04-08T00:30:00Z', updatedAt: '2026-04-08T01:00:00Z', completedAt: '2026-04-08T01:00:00Z'
  },
  {
    id: 'j3', projectId: '1', name: 'KV Cache 프로파일링',
    status: 'waiting', prompt: 'Profile KV cache quantization...', steps: [], artifacts: [],
    createdAt: '2026-04-08T01:15:00Z', updatedAt: '2026-04-08T01:45:00Z'
  },
  {
    id: 'j4', projectId: '1', name: 'vLLM 빌드 에러 수정',
    status: 'failed', prompt: 'Fix vLLM build error...', steps: [], artifacts: [],
    createdAt: '2026-04-08T00:00:00Z', updatedAt: '2026-04-08T00:20:00Z'
  },
  {
    id: 'j5', projectId: '2', name: 'Electron 보일러플레이트',
    status: 'running', prompt: 'Set up Electron + React project...', steps: [], artifacts: [],
    createdAt: '2026-04-08T02:00:00Z', updatedAt: '2026-04-08T02:30:00Z'
  }
]

export default function App() {
  const [activeProjectId, setActiveProjectId] = useState<string>('1')
  const [activeJobId, setActiveJobId] = useState<string | null>('j1')

  const activeProject = DEMO_PROJECTS.find(p => p.id === activeProjectId)
  const projectJobs = DEMO_JOBS.filter(j => j.projectId === activeProjectId)
  const activeJob = activeJobId ? DEMO_JOBS.find(j => j.id === activeJobId) : null

  return (
    <CommandCenter
      projects={DEMO_PROJECTS}
      activeProject={activeProject || null}
      jobs={projectJobs}
      allJobs={DEMO_JOBS}
      activeJob={activeJob || null}
      onSelectProject={setActiveProjectId}
      onSelectJob={setActiveJobId}
    />
  )
}

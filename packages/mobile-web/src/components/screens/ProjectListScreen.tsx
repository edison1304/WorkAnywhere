import type { Project, Phase, Task } from '@shared/types'

export function ProjectListScreen({ projects, phases, tasks, onSelect }: {
  projects: Project[]; phases: Phase[]; tasks: Task[]; onSelect: (id: string) => void
}) {
  return (
    <div style={{ padding:16 }}>
      <h1 style={{ fontSize:22, fontWeight:700, color:'#fafafa', marginBottom:16 }}>Projects</h1>
      {projects.length === 0 && <div style={{ color:'#52525b', textAlign:'center', padding:40 }}>프로젝트가 없습니다</div>}
      {projects.map(p => {
        const pt = tasks.filter(t => t.projectId === p.id)
        const run = pt.filter(t => t.status === 'running').length
        const wait = pt.filter(t => t.status === 'waiting' || t.status === 'review').length
        return (
          <div key={p.id} onClick={() => onSelect(p.id)} style={{ padding:16, marginBottom:10, background:'#18181b', border:'1px solid #27272a', borderRadius:12, cursor:'pointer' }}>
            <div style={{ fontSize:16, fontWeight:600, color:'#fafafa', marginBottom:6 }}>{p.name}</div>
            <div style={{ fontSize:12, color:'#71717a', marginBottom:10 }}>{p.workspacePath}</div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', fontSize:12 }}>
              <span style={{ color:'#71717a' }}>{phases.filter(ph => ph.projectId === p.id).length} phases · {pt.length} tasks</span>
              {run > 0 && <span style={{ color:'#4ade80' }}>● {run} running</span>}
              {wait > 0 && <span style={{ color:'#facc15' }}>● {wait} waiting</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

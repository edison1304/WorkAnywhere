import type { Project, Phase, Task } from '@shared/types'
import { StatusBadge } from '../common/StatusBadge'

export function TaskListScreen({ project, phases, tasks, onSelectTask, onBack }: {
  project: Project; phases: Phase[]; tasks: Task[]; onSelectTask: (t: Task) => void; onBack: () => void
}) {
  const pp = phases.filter(ph => ph.projectId === project.id).sort((a, b) => a.order - b.order)
  return (
    <div style={{ height:'100dvh', display:'flex', flexDirection:'column', background:'#09090b' }}>
      <div style={{ padding:'12px 16px', borderBottom:'1px solid #27272a', display:'flex', alignItems:'center', gap:12 }}>
        <button onClick={onBack} style={{ background:'none', border:'none', color:'#71717a', fontSize:20, cursor:'pointer', padding:'4px 8px' }}>←</button>
        <div style={{ fontSize:17, fontWeight:700, color:'#fafafa' }}>{project.name}</div>
      </div>
      <div style={{ flex:1, overflow:'auto', padding:'8px 0' }}>
        {pp.map(phase => {
          const pt = tasks.filter(t => t.phaseId === phase.id).sort((a, b) => a.order - b.order)
          return (
            <div key={phase.id} style={{ marginBottom:16 }}>
              <div style={{ padding:'8px 16px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <span style={{ fontSize:13, fontWeight:700, color:'#a1a1aa' }}>{phase.name}</span>
                <StatusBadge status={phase.status} />
              </div>
              {pt.map(task => (
                <div key={task.id} onClick={() => onSelectTask(task)} style={{ padding:'12px 16px', margin:'0 16px 6px', background:'#18181b', border:'1px solid #27272a', borderRadius:10, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:14, fontWeight:500, color:'#e4e4e7', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{task.name}</div>
                    <div style={{ fontSize:11, color:'#71717a', marginTop:2 }}>{task.logs.length} logs · {task.artifacts.length} artifacts</div>
                  </div>
                  <StatusBadge status={task.status} />
                </div>
              ))}
              {pt.length === 0 && <div style={{ padding:'8px 32px', fontSize:12, color:'#3f3f46' }}>태스크 없음</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

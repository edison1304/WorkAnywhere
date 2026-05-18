import type { TaskStatus, PhaseStatus } from '@shared/types'

const S: Record<string, [string, string, string]> = {
  idle:['#888','#2a2a2e','대기'], queued:['#c8a832','#2d2a1e','대기열'],
  running:['#4ade80','#1a2e1a','실행 중'], waiting:['#facc15','#2e2a1a','입력 대기'],
  review:['#60a5fa','#1a1e2e','검토'], completed:['#22c55e','#1a2e1a','완료'],
  failed:['#ef4444','#2e1a1a','실패'], active:['#4ade80','#1a2e1a','활성'],
  paused:['#c8a832','#2d2a1e','일시정지'],
}

export function StatusBadge({ status }: { status: TaskStatus | PhaseStatus }) {
  const [c, bg, label] = S[status] || S.idle
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'3px 10px', borderRadius:12, fontSize:12, fontWeight:600, background:bg, color:c }}>
      <span style={{ width:6, height:6, borderRadius:'50%', background:c, animation: status==='running'?'pulse 1.5s infinite':undefined }} />
      {label}
    </span>
  )
}

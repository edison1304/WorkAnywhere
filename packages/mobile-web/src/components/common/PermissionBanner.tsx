export function PermissionBanner({ request, onRespond }: {
  request: { taskId: string; id: string; text: string; format: 'numbered' | 'yn' }
  onRespond: (approved: boolean) => void
}) {
  return (
    <div style={{ position:'sticky', top:0, zIndex:100, background:'linear-gradient(135deg,#1e1b4b,#312e81)', borderBottom:'2px solid #6366f1', padding:'12px 16px', display:'flex', flexDirection:'column', gap:10 }}>
      <div style={{ fontSize:12, color:'#a5b4fc', fontWeight:600 }}>Permission Request</div>
      <div style={{ fontSize:13, color:'#e0e7ff', whiteSpace:'pre-wrap', maxHeight:120, overflow:'auto', fontFamily:'monospace', lineHeight:1.4 }}>{request.text}</div>
      <div style={{ display:'flex', gap:10 }}>
        <button onClick={() => onRespond(true)} style={{ flex:1, padding:'10px 0', background:'#22c55e', color:'#000', border:'none', borderRadius:8, fontSize:14, fontWeight:700, cursor:'pointer' }}>Approve</button>
        <button onClick={() => onRespond(false)} style={{ flex:1, padding:'10px 0', background:'#3f3f46', color:'#d4d4d8', border:'1px solid #52525b', borderRadius:8, fontSize:14, fontWeight:700, cursor:'pointer' }}>Deny</button>
      </div>
    </div>
  )
}

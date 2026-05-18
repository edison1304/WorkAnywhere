import { useState, useEffect, useRef, useCallback } from 'react'
import type { Task } from '@shared/types'
import type { GatewayClient } from '../../api/client'
import { StatusBadge } from '../common/StatusBadge'
import { ChatBubble } from '../common/ChatBubble'
import { PermissionBanner } from '../common/PermissionBanner'

interface PermReq { taskId: string; id: string; text: string; format: 'numbered' | 'yn' }

export function TaskChatScreen({ task, client, onBack }: {
  task: Task; client: GatewayClient; onBack: () => void
}) {
  const [input, setInput] = useState('')
  const [permReq, setPermReq] = useState<PermReq | null>(null)
  const feedRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    feedRef.current && (feedRef.current.scrollTop = feedRef.current.scrollHeight)
  }, [task.logs.length])

  useEffect(() => {
    return client.on('permission:request', (d: PermReq) => { if (d.taskId === task.id) setPermReq(d) })
  }, [client, task.id])

  const isActive = task.status === 'running' || task.status === 'waiting' || task.status === 'queued'

  const handleSend = useCallback(async () => {
    const msg = input.trim(); if (!msg) return; setInput('')
    if (task.status === 'idle' || task.status === 'completed' || task.status === 'failed') {
      await client.taskRun(task.id)
    } else {
      await client.taskSend(task.id, msg)
    }
  }, [input, task, client])

  const handlePerm = useCallback(async (ok: boolean) => {
    if (!permReq) return
    await client.taskRespondPermission(task.id, ok, permReq.format)
    setPermReq(null)
  }, [permReq, task.id, client])

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100dvh', background:'#09090b', color:'#d4d4d8' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px', borderBottom:'1px solid #27272a', background:'#0a0a0c' }}>
        <button onClick={onBack} style={{ background:'none', border:'none', color:'#71717a', fontSize:20, cursor:'pointer', padding:'4px 8px' }}>←</button>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:15, fontWeight:600, color:'#fafafa', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{task.name}</div>
          <div style={{ fontSize:11, color:'#71717a', marginTop:2 }}>{task.purpose}</div>
        </div>
        <StatusBadge status={task.status} />
      </div>

      {permReq && <PermissionBanner request={permReq} onRespond={handlePerm} />}

      {/* Feed */}
      <div ref={feedRef} style={{ flex:1, overflow:'auto', padding:'8px 12px', WebkitOverflowScrolling:'touch' }}>
        {task.prompt && (
          <div style={{ padding:'10px 14px', marginBottom:8, background:'rgba(99,102,241,0.12)', borderRadius:12, border:'1px solid rgba(99,102,241,0.3)', fontSize:13, color:'#c7d2fe', whiteSpace:'pre-wrap' }}>
            <div style={{ fontSize:10, fontWeight:700, color:'#818cf8', marginBottom:4 }}>PROMPT</div>
            {task.prompt}
          </div>
        )}
        {task.logs.map(log => <ChatBubble key={log.id} log={log} />)}
        {task.summary && (
          <div style={{ margin:'12px 0', padding:12, background:'rgba(34,197,94,0.08)', border:'1px solid rgba(34,197,94,0.2)', borderRadius:12, fontSize:12 }}>
            <div style={{ fontWeight:700, color:'#4ade80', marginBottom:6 }}>Summary</div>
            <div style={{ color:'#a1a1aa' }}>{task.summary.progress}</div>
            {task.summary.nextPrompt && (
              <div style={{ marginTop:6, color:'#93c5fd', cursor:'pointer', textDecoration:'underline' }} onClick={() => setInput(task.summary!.nextPrompt!)}>
                Suggested: {task.summary.nextPrompt}
              </div>
            )}
          </div>
        )}
        {task.logs.length === 0 && !task.prompt && (
          <div style={{ textAlign:'center', padding:'60px 20px', color:'#52525b', fontSize:14 }}>프롬프트를 입력하여 에이전트를 시작하세요</div>
        )}
      </div>

      {/* Input */}
      <div style={{ padding:'8px 12px', paddingBottom:'max(8px, env(safe-area-inset-bottom))', borderTop:'1px solid #27272a', background:'#0a0a0c', display:'flex', gap:8, alignItems:'flex-end' }}>
        {isActive && (
          <button onClick={() => client.taskStop(task.id)} style={{ padding:'10px 14px', background:'#7f1d1d', color:'#fca5a5', border:'none', borderRadius:10, fontSize:13, fontWeight:600, cursor:'pointer' }}>Stop</button>
        )}
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          placeholder={isActive ? '메시지 입력...' : '프롬프트 입력 후 Enter로 실행'}
          style={{ flex:1, padding:'10px 14px', background:'#18181b', border:'1px solid #3f3f46', borderRadius:10, color:'#fafafa', fontSize:14, outline:'none' }}
        />
        <button onClick={handleSend} disabled={!input.trim()}
          style={{ padding:'10px 18px', background: input.trim()?'#4f46e5':'#27272a', color: input.trim()?'#fff':'#52525b', border:'none', borderRadius:10, fontSize:14, fontWeight:700, cursor: input.trim()?'pointer':'default' }}>
          {isActive ? 'Send' : 'Run'}
        </button>
      </div>
    </div>
  )
}

import type { LogEntry } from '@shared/types'

const C: Record<string, string> = {
  agent_start:'#4ade80', tool_call:'#60a5fa', text:'#d4d4d8', error:'#ef4444', agent_end:'#888',
}

export function ChatBubble({ log }: { log: LogEntry }) {
  const c = C[log.type] || C.text
  const isTool = log.type === 'tool_call'
  const isErr = log.type === 'error'
  return (
    <div style={{ padding:'8px 12px', marginBottom:4, borderLeft:`3px solid ${c}`, background: isErr?'rgba(239,68,68,0.08)':'rgba(255,255,255,0.03)', borderRadius:'0 8px 8px 0', fontSize:13, lineHeight:1.5, wordBreak:'break-word' }}>
      {isTool && log.meta?.tool && (
        <div style={{ fontSize:11, fontWeight:700, color:c, marginBottom:4, fontFamily:'monospace' }}>
          {log.meta.tool}{log.meta.duration ? ` (${(log.meta.duration/1000).toFixed(1)}s)` : ''}
        </div>
      )}
      <div style={{ color:c, whiteSpace:'pre-wrap', fontFamily: isTool?'monospace':'inherit', fontSize: isTool?12:13 }}>
        {log.content}
      </div>
      <div style={{ fontSize:10, color:'#555', marginTop:4, textAlign:'right' }}>
        {new Date(log.timestamp).toLocaleTimeString()}
      </div>
    </div>
  )
}

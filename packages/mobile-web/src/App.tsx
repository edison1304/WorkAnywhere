import { useState, useMemo, useCallback } from 'react'
import type { Task } from '@shared/types'
import { GatewayClient } from './api/client'
import { useSync } from './hooks/useSync'
import { ProjectListScreen } from './components/screens/ProjectListScreen'
import { TaskListScreen } from './components/screens/TaskListScreen'
import { TaskChatScreen } from './components/screens/TaskChatScreen'

type Screen = { type:'setup' } | { type:'projects' } | { type:'tasks'; projectId:string } | { type:'chat'; task:Task }

export default function App() {
  const [screen, setScreen] = useState<Screen>(() => {
    const url = localStorage.getItem('gw_url'), tok = localStorage.getItem('gw_token')
    return url && tok ? { type: 'projects' } : { type: 'setup' }
  })
  const [url, setUrl] = useState(localStorage.getItem('gw_url') || '')
  const [token, setToken] = useState(localStorage.getItem('gw_token') || '')

  const client = useMemo(() => {
    if (!url || !token) return null
    return new GatewayClient(url.replace(/\/$/, ''), token)
  }, [url, token])

  const { projects, phases, tasks, connected, loading } = useSync(client)

  const handleConnect = useCallback(() => {
    if (!url || !token) return
    localStorage.setItem('gw_url', url); localStorage.setItem('gw_token', token)
    setScreen({ type: 'projects' })
  }, [url, token])

  const currentTask = screen.type === 'chat' ? tasks.find(t => t.id === screen.task.id) || screen.task : null

  // Setup
  if (screen.type === 'setup') return (
    <div style={{ height:'100dvh', display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', padding:24, background:'#09090b', color:'#d4d4d8' }}>
      <div style={{ fontSize:28, fontWeight:800, color:'#fafafa', marginBottom:8 }}>WorkAnywhere</div>
      <div style={{ fontSize:13, color:'#71717a', marginBottom:32 }}>Connect to your gateway server</div>
      <input value={url} onChange={e => setUrl(e.target.value)} placeholder="http://server:3847"
        style={{ width:'100%', maxWidth:360, padding:'12px 16px', marginBottom:12, background:'#18181b', border:'1px solid #3f3f46', borderRadius:10, color:'#fafafa', fontSize:15, outline:'none' }} />
      <input value={token} onChange={e => setToken(e.target.value)} placeholder="Access token" type="password"
        style={{ width:'100%', maxWidth:360, padding:'12px 16px', marginBottom:20, background:'#18181b', border:'1px solid #3f3f46', borderRadius:10, color:'#fafafa', fontSize:15, outline:'none' }} />
      <button onClick={handleConnect} disabled={!url||!token}
        style={{ width:'100%', maxWidth:360, padding:'14px 0', background: url&&token?'#4f46e5':'#27272a', color: url&&token?'#fff':'#52525b', border:'none', borderRadius:10, fontSize:16, fontWeight:700, cursor: url&&token?'pointer':'default' }}>
        Connect
      </button>
    </div>
  )

  if (loading) return (
    <div style={{ height:'100dvh', display:'flex', justifyContent:'center', alignItems:'center', background:'#09090b', color:'#71717a' }}>Loading...</div>
  )

  if (screen.type === 'chat' && currentTask) return (
    <TaskChatScreen task={currentTask} client={client!} onBack={() => setScreen({ type:'tasks', projectId: currentTask.projectId })} />
  )

  if (screen.type === 'tasks') {
    const p = projects.find(x => x.id === screen.projectId)
    if (!p) { setScreen({ type:'projects' }); return null }
    return <TaskListScreen project={p} phases={phases} tasks={tasks} onSelectTask={t => setScreen({ type:'chat', task:t })} onBack={() => setScreen({ type:'projects' })} />
  }

  return (
    <div style={{ height:'100dvh', display:'flex', flexDirection:'column', background:'#09090b', color:'#d4d4d8' }}>
      <div style={{ padding:'6px 16px', background: connected?'rgba(34,197,94,0.1)':'rgba(239,68,68,0.1)', borderBottom:`1px solid ${connected?'rgba(34,197,94,0.2)':'rgba(239,68,68,0.2)'}`, fontSize:11, display:'flex', justifyContent:'space-between' }}>
        <span style={{ color: connected?'#4ade80':'#ef4444' }}>{connected ? '● Connected' : '● Disconnected'}</span>
        <span style={{ color:'#52525b', cursor:'pointer' }} onClick={() => { localStorage.clear(); setUrl(''); setToken(''); setScreen({ type:'setup' }) }}>Disconnect</span>
      </div>
      <div style={{ flex:1, overflow:'auto' }}>
        <ProjectListScreen projects={projects} phases={phases} tasks={tasks} onSelect={id => setScreen({ type:'tasks', projectId:id })} />
      </div>
    </div>
  )
}

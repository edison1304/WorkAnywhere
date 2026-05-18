import React, { useState, useMemo, useCallback, useRef } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, StatusBar } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Task } from '@shared/types'
import { GatewayClient } from './api/client'
import { SSHTunnel, type SSHConfig, type TunnelStatus } from './services/SSHTunnel'
import { useSync } from './hooks/useSync'
import { SetupScreen } from './components/screens/SetupScreen'
import { ProjectListScreen } from './components/screens/ProjectListScreen'
import { TaskListScreen } from './components/screens/TaskListScreen'
import { TaskChatScreen } from './components/screens/TaskChatScreen'
import { colors } from './styles/theme'

type Screen =
  | { type: 'setup' }
  | { type: 'projects' }
  | { type: 'tasks'; projectId: string }
  | { type: 'chat'; task: Task }

/**
 * App — React Native 메인 컨트롤러.
 *
 * 1. SSH 접속 (SetupScreen)
 * 2. SSH 터널 생성 (localhost:3847 → server:3847)
 * 3. Gateway 자동 확인 + 토큰 획득
 * 4. GatewayClient로 REST/WebSocket 통신
 * 5. Project → Task → Chat (바이브코딩)
 */
export default function App() {
  const [screen, setScreen] = useState<Screen>({ type: 'setup' })
  const [connecting, setConnecting] = useState(false)
  const [connError, setConnError] = useState<string | null>(null)
  const [tunnelStatus, setTunnelStatus] = useState<TunnelStatus>('disconnected')
  const [gatewayToken, setGatewayToken] = useState('')
  const [initialized, setInitialized] = useState(false)

  const tunnelRef = useRef(new SSHTunnel())
  const tunnel = tunnelRef.current

  // GatewayClient — created after SSH tunnel + token are ready
  const client = useMemo(() => {
    if (tunnelStatus !== 'connected' || !gatewayToken) return null
    return new GatewayClient(tunnel.gatewayUrl, gatewayToken)
  }, [tunnelStatus, gatewayToken, tunnel.gatewayUrl])

  const { projects, phases, tasks, connected, loading } = useSync(client)

  // Try restoring saved SSH config on mount
  React.useEffect(() => {
    AsyncStorage.getItem('ssh_config').then(raw => {
      if (raw) {
        try {
          const config: SSHConfig = JSON.parse(raw)
          handleConnect(config)
        } catch { /* corrupt saved config */ }
      }
      setInitialized(true)
    })

    // Listen to tunnel status changes
    const unsub = tunnel.onStatusChange((status, error) => {
      setTunnelStatus(status)
      if (error) setConnError(error)
    })

    return () => { unsub(); tunnel.disconnect() }
  }, [])

  const handleConnect = useCallback(async (config: SSHConfig) => {
    setConnecting(true)
    setConnError(null)

    try {
      // Step 1: SSH connect + port forwarding
      await tunnel.connect(config)

      // Step 2: Ensure Gateway is running, get token
      const { token } = await tunnel.ensureGateway()
      setGatewayToken(token)

      // Step 3: Save config for next launch (exclude password for security)
      const saveConfig = { ...config }
      if (config.authMethod === 'password') {
        // Optionally save password — user can choose
        // For now, save it for convenience (encrypted storage recommended in production)
      }
      await AsyncStorage.setItem('ssh_config', JSON.stringify(saveConfig))

      setScreen({ type: 'projects' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setConnError(msg)
    } finally {
      setConnecting(false)
    }
  }, [tunnel])

  const handleDisconnect = useCallback(async () => {
    await tunnel.disconnect()
    await AsyncStorage.removeItem('ssh_config')
    setGatewayToken('')
    setScreen({ type: 'setup' })
  }, [tunnel])

  // Keep selected task in sync with latest state
  const currentTask = screen.type === 'chat'
    ? tasks.find(t => t.id === screen.task.id) || screen.task
    : null

  if (!initialized) return null

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />

      {/* Setup (SSH login) */}
      {screen.type === 'setup' && (
        <SetupScreen
          onConnect={handleConnect}
          connecting={connecting}
          error={connError}
        />
      )}

      {/* Loading */}
      {screen.type !== 'setup' && loading && (
        <View style={styles.loading}>
          <Text style={styles.loadingText}>Loading data...</Text>
        </View>
      )}

      {/* Task Chat */}
      {screen.type === 'chat' && currentTask && !loading && (
        <TaskChatScreen
          task={currentTask}
          client={client!}
          onBack={() => setScreen({ type: 'tasks', projectId: currentTask.projectId })}
        />
      )}

      {/* Task List */}
      {screen.type === 'tasks' && !loading && (() => {
        const project = projects.find(p => p.id === screen.projectId)
        if (!project) { setScreen({ type: 'projects' }); return null }
        return (
          <SafeAreaView style={styles.screen} edges={['top']}>
            <TaskListScreen
              project={project}
              phases={phases}
              tasks={tasks}
              onSelectTask={(task) => setScreen({ type: 'chat', task })}
              onBack={() => setScreen({ type: 'projects' })}
            />
          </SafeAreaView>
        )
      })()}

      {/* Project List */}
      {screen.type === 'projects' && !loading && (
        <SafeAreaView style={styles.screen} edges={['top']}>
          {/* Connection status bar */}
          <View style={[styles.connBar, connected ? styles.connOk : styles.connFail]}>
            <View style={styles.connInfo}>
              <Text style={[styles.connDot, { color: connected ? colors.green : colors.red }]}>
                {connected ? '●' : '○'}
              </Text>
              <Text style={styles.connLabel}>
                {tunnelStatus === 'connected' && connected
                  ? 'SSH + Gateway connected'
                  : tunnelStatus === 'connected'
                  ? 'SSH connected, syncing...'
                  : 'Disconnected'}
              </Text>
            </View>
            <TouchableOpacity onPress={handleDisconnect}>
              <Text style={styles.disconnectBtn}>Disconnect</Text>
            </TouchableOpacity>
          </View>
          <ProjectListScreen
            projects={projects}
            phases={phases}
            tasks={tasks}
            onSelect={(projectId) => setScreen({ type: 'tasks', projectId })}
          />
        </SafeAreaView>
      )}
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
  loadingText: { color: colors.textMuted, fontSize: 15 },
  connBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  connOk: {
    backgroundColor: 'rgba(34,197,94,0.1)',
    borderBottomColor: 'rgba(34,197,94,0.2)',
  },
  connFail: {
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderBottomColor: 'rgba(239,68,68,0.2)',
  },
  connInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  connDot: { fontSize: 10 },
  connLabel: { fontSize: 11, color: colors.textMuted },
  disconnectBtn: { fontSize: 11, color: colors.textDim },
})

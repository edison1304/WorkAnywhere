import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  KeyboardAvoidingView, Platform, StyleSheet,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { Task, LogEntry } from '@shared/types'
import type { GatewayClient } from '../../api/client'
import { StatusBadge } from '../common/StatusBadge'
import { ChatBubble } from '../common/ChatBubble'
import { PermissionBanner } from '../common/PermissionBanner'
import { colors } from '../../styles/theme'

interface PermissionRequest {
  taskId: string; id: string; text: string; format: 'numbered' | 'yn'
}

/**
 * TaskChatScreen — 모바일 바이브코딩 핵심 화면.
 *
 * 에이전트 로그를 채팅 버블로 실시간 스트리밍.
 * 프롬프트 전송, 퍼미션 승인/거부, Run/Stop 제어.
 */
export function TaskChatScreen({ task, client, onBack }: {
  task: Task
  client: GatewayClient
  onBack: () => void
}) {
  const [input, setInput] = useState('')
  const [permReq, setPermReq] = useState<PermissionRequest | null>(null)
  const listRef = useRef<FlatList>(null)

  // Listen for permission requests
  useEffect(() => {
    const unsub = client.on('permission:request', (data: PermissionRequest) => {
      if (data.taskId === task.id) setPermReq(data)
    })
    return unsub
  }, [client, task.id])

  // Auto-scroll on new logs
  useEffect(() => {
    if (task.logs.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)
    }
  }, [task.logs.length])

  const isActive = task.status === 'running' || task.status === 'waiting' || task.status === 'queued'

  const handleSend = useCallback(async () => {
    const msg = input.trim()
    if (!msg) return
    setInput('')
    if (task.status === 'idle' || task.status === 'completed' || task.status === 'failed') {
      await client.taskRun(task.id)
    } else {
      await client.taskSend(task.id, msg)
    }
  }, [input, task, client])

  const handleStop = useCallback(async () => {
    await client.taskStop(task.id)
  }, [task.id, client])

  const handlePermission = useCallback(async (approved: boolean) => {
    if (!permReq) return
    await client.taskRespondPermission(task.id, approved, permReq.format)
    setPermReq(null)
  }, [permReq, task.id, client])

  const renderLog = ({ item }: { item: LogEntry }) => <ChatBubble log={item} />

  // Build data: prompt header + logs
  const headerData: LogEntry[] = task.prompt ? [{
    id: '__prompt__',
    taskId: task.id,
    timestamp: task.createdAt,
    type: 'text',
    content: task.prompt,
  }] : []

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>{'←'}</Text>
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.taskName} numberOfLines={1}>{task.name}</Text>
          <Text style={styles.taskPurpose} numberOfLines={1}>{task.purpose}</Text>
        </View>
        <StatusBadge status={task.status} />
      </View>

      {/* Permission banner */}
      {permReq && <PermissionBanner request={permReq} onRespond={handlePermission} />}

      {/* Chat feed */}
      <KeyboardAvoidingView
        style={styles.chatArea}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={listRef}
          data={task.logs}
          renderItem={renderLog}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.feedContent}
          ListHeaderComponent={
            task.prompt ? (
              <View style={styles.promptBox}>
                <Text style={styles.promptLabel}>PROMPT</Text>
                <Text style={styles.promptText}>{task.prompt}</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            !task.prompt ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>
                  프롬프트를 입력하여 에이전트를 시작하세요
                </Text>
              </View>
            ) : null
          }
          ListFooterComponent={
            task.summary ? (
              <View style={styles.summaryBox}>
                <Text style={styles.summaryHeader}>Summary</Text>
                <Text style={styles.summaryProgress}>{task.summary.progress}</Text>
                {task.summary.problem && (
                  <Text style={styles.summaryLine}>
                    <Text style={{ color: colors.red, fontWeight: '600' }}>Problem: </Text>
                    {task.summary.problem}
                  </Text>
                )}
                {task.summary.nextPrompt && (
                  <TouchableOpacity onPress={() => setInput(task.summary!.nextPrompt!)}>
                    <Text style={styles.summaryLine}>
                      <Text style={{ color: colors.blue, fontWeight: '600' }}>Suggested: </Text>
                      <Text style={styles.suggestedText}>{task.summary.nextPrompt}</Text>
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : null
          }
        />

        {/* Input bar */}
        <SafeAreaView edges={['bottom']} style={styles.inputBar}>
          {isActive && (
            <TouchableOpacity style={styles.stopBtn} onPress={handleStop} activeOpacity={0.7}>
              <Text style={styles.stopBtnText}>Stop</Text>
            </TouchableOpacity>
          )}
          <TextInput
            value={input}
            onChangeText={setInput}
            onSubmitEditing={handleSend}
            placeholder={isActive ? '메시지 입력...' : '프롬프트 입력 후 전송'}
            placeholderTextColor={colors.textDim}
            style={styles.input}
            returnKeyType="send"
            blurOnSubmit={false}
          />
          <TouchableOpacity
            style={[styles.sendBtn, !input.trim() && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!input.trim()}
            activeOpacity={0.7}
          >
            <Text style={[styles.sendBtnText, !input.trim() && styles.sendBtnTextDisabled]}>
              {isActive ? 'Send' : 'Run'}
            </Text>
          </TouchableOpacity>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: '#0a0a0c',
  },
  backBtn: { padding: 4 },
  backText: { fontSize: 20, color: colors.textMuted },
  headerInfo: { flex: 1 },
  taskName: { fontSize: 15, fontWeight: '600', color: colors.textBright },
  taskPurpose: { fontSize: 11, color: colors.textMuted, marginTop: 2 },

  chatArea: { flex: 1 },
  feedContent: { padding: 12 },

  promptBox: {
    padding: 12,
    marginBottom: 8,
    backgroundColor: colors.primaryBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
  },
  promptLabel: { fontSize: 10, fontWeight: '700', color: colors.indigo, marginBottom: 4 },
  promptText: { fontSize: 13, color: '#c7d2fe' },

  emptyBox: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 20 },
  emptyText: { fontSize: 14, color: colors.textDim },

  summaryBox: {
    marginTop: 12,
    padding: 12,
    backgroundColor: colors.greenBg,
    borderWidth: 1,
    borderColor: colors.greenBorder,
    borderRadius: 12,
  },
  summaryHeader: { fontWeight: '700', color: colors.green, marginBottom: 6, fontSize: 12 },
  summaryProgress: { color: '#a1a1aa', fontSize: 12 },
  summaryLine: { marginTop: 6, fontSize: 12, color: colors.text },
  suggestedText: { color: '#93c5fd', textDecorationLine: 'underline' },

  inputBar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: '#0a0a0c',
    alignItems: 'flex-end',
  },
  stopBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.redBg,
    borderRadius: 10,
  },
  stopBtnText: { fontSize: 13, fontWeight: '600', color: colors.redLight },
  input: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 10,
    color: colors.textBright,
    fontSize: 14,
  },
  sendBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: colors.primary,
    borderRadius: 10,
  },
  sendBtnDisabled: { backgroundColor: colors.border },
  sendBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  sendBtnTextDisabled: { color: colors.textDim },
})

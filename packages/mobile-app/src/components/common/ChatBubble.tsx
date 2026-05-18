import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import type { LogEntry } from '@shared/types'
import { colors } from '../../styles/theme'

const TYPE_COLORS: Record<string, string> = {
  agent_start: colors.green,
  tool_call:   colors.blue,
  text:        colors.text,
  error:       colors.red,
  agent_end:   colors.textMuted,
}

export function ChatBubble({ log }: { log: LogEntry }) {
  const color = TYPE_COLORS[log.type] || colors.text
  const isToolCall = log.type === 'tool_call'
  const isError = log.type === 'error'

  return (
    <View style={[
      styles.container,
      { borderLeftColor: color },
      isError && styles.errorBg,
    ]}>
      {isToolCall && log.meta?.tool && (
        <Text style={[styles.toolName, { color }]}>
          {log.meta.tool}
          {log.meta.duration ? ` (${(log.meta.duration / 1000).toFixed(1)}s)` : ''}
        </Text>
      )}
      <Text style={[
        styles.content,
        { color },
        isToolCall && styles.mono,
      ]}>
        {log.content}
      </Text>
      <Text style={styles.time}>
        {new Date(log.timestamp).toLocaleTimeString()}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 4,
    borderLeftWidth: 3,
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  errorBg: {
    backgroundColor: 'rgba(239,68,68,0.08)',
  },
  toolName: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  content: {
    fontSize: 13,
    lineHeight: 20,
  },
  mono: {
    fontFamily: 'monospace',
    fontSize: 12,
  },
  time: {
    fontSize: 10,
    color: colors.textDim,
    marginTop: 4,
    textAlign: 'right',
  },
})

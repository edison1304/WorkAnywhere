import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import type { TaskStatus, PhaseStatus } from '@shared/types'
import { STATUS_META } from '../../styles/theme'

export function StatusBadge({ status }: { status: TaskStatus | PhaseStatus }) {
  const meta = STATUS_META[status] || STATUS_META.idle
  return (
    <View style={[styles.badge, { backgroundColor: meta.bg }]}>
      <View style={[styles.dot, { backgroundColor: meta.color }]} />
      <Text style={[styles.label, { color: meta.color }]}>{meta.label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
})

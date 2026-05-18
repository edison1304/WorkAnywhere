import React from 'react'
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native'
import { colors } from '../../styles/theme'

interface PermissionRequest {
  taskId: string
  id: string
  text: string
  format: 'numbered' | 'yn'
}

export function PermissionBanner({ request, onRespond }: {
  request: PermissionRequest
  onRespond: (approved: boolean) => void
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.header}>Permission Request</Text>
      <ScrollView style={styles.textBox}>
        <Text style={styles.text}>{request.text}</Text>
      </ScrollView>
      <View style={styles.buttons}>
        <TouchableOpacity
          style={styles.approveBtn}
          onPress={() => onRespond(true)}
          activeOpacity={0.7}
        >
          <Text style={styles.approveBtnText}>Approve</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.denyBtn}
          onPress={() => onRespond(false)}
          activeOpacity={0.7}
        >
          <Text style={styles.denyBtnText}>Deny</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.indigoBg,
    borderBottomWidth: 2,
    borderBottomColor: colors.primaryLight,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  header: {
    fontSize: 12,
    fontWeight: '600',
    color: '#a5b4fc',
  },
  textBox: {
    maxHeight: 120,
  },
  text: {
    fontSize: 13,
    color: '#e0e7ff',
    fontFamily: 'monospace',
    lineHeight: 18,
  },
  buttons: {
    flexDirection: 'row',
    gap: 10,
  },
  approveBtn: {
    flex: 1,
    paddingVertical: 10,
    backgroundColor: colors.greenDark,
    borderRadius: 8,
    alignItems: 'center',
  },
  approveBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#000',
  },
  denyBtn: {
    flex: 1,
    paddingVertical: 10,
    backgroundColor: colors.borderLight,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.textDim,
    alignItems: 'center',
  },
  denyBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
})

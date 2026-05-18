import React from 'react'
import { View, Text, TouchableOpacity, SectionList, StyleSheet } from 'react-native'
import type { Project, Phase, Task } from '@shared/types'
import { StatusBadge } from '../common/StatusBadge'
import { colors } from '../../styles/theme'

export function TaskListScreen({ project, phases, tasks, onSelectTask, onBack }: {
  project: Project
  phases: Phase[]
  tasks: Task[]
  onSelectTask: (task: Task) => void
  onBack: () => void
}) {
  const sections = phases
    .filter(ph => ph.projectId === project.id)
    .sort((a, b) => a.order - b.order)
    .map(phase => ({
      phase,
      data: tasks
        .filter(t => t.phaseId === phase.id)
        .sort((a, b) => a.order - b.order),
    }))

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>{'←'}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{project.name}</Text>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={item => item.id}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionName}>{section.phase.name}</Text>
            <StatusBadge status={section.phase.status} />
          </View>
        )}
        renderItem={({ item: task }) => (
          <TouchableOpacity
            style={styles.taskCard}
            onPress={() => onSelectTask(task)}
            activeOpacity={0.7}
          >
            <View style={styles.taskInfo}>
              <Text style={styles.taskName} numberOfLines={1}>{task.name}</Text>
              <Text style={styles.taskMeta}>
                {task.logs.length} logs · {task.artifacts.length} artifacts
              </Text>
              {task.summary?.progress && (
                <Text style={styles.taskProgress} numberOfLines={1}>
                  {task.summary.progress}
                </Text>
              )}
            </View>
            <StatusBadge status={task.status} />
          </TouchableOpacity>
        )}
        renderSectionFooter={({ section }) =>
          section.data.length === 0 ? (
            <Text style={styles.emptySection}>태스크 없음</Text>
          ) : null
        }
        contentContainerStyle={styles.listContent}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { padding: 4 },
  backText: { fontSize: 20, color: colors.textMuted },
  title: { fontSize: 17, fontWeight: '700', color: colors.textBright },
  listContent: { paddingVertical: 8 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  sectionName: { fontSize: 13, fontWeight: '700', color: '#a1a1aa' },
  taskCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    gap: 12,
  },
  taskInfo: { flex: 1 },
  taskName: { fontSize: 14, fontWeight: '500', color: '#e4e4e7' },
  taskMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  taskProgress: { fontSize: 11, color: '#a1a1aa', marginTop: 4 },
  emptySection: { paddingHorizontal: 32, paddingVertical: 8, fontSize: 12, color: colors.borderLight },
})

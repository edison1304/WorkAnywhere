import React from 'react'
import { View, Text, TouchableOpacity, FlatList, StyleSheet } from 'react-native'
import type { Project, Phase, Task } from '@shared/types'
import { colors } from '../../styles/theme'

export function ProjectListScreen({ projects, phases, tasks, onSelect }: {
  projects: Project[]
  phases: Phase[]
  tasks: Task[]
  onSelect: (projectId: string) => void
}) {
  const renderProject = ({ item: project }: { item: Project }) => {
    const pTasks = tasks.filter(t => t.projectId === project.id)
    const running = pTasks.filter(t => t.status === 'running').length
    const waiting = pTasks.filter(t => t.status === 'waiting' || t.status === 'review').length
    const done = pTasks.filter(t => t.status === 'completed').length
    const pPhases = phases.filter(ph => ph.projectId === project.id)

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => onSelect(project.id)}
        activeOpacity={0.7}
      >
        <Text style={styles.name}>{project.name}</Text>
        <Text style={styles.path}>{project.workspacePath}</Text>
        <View style={styles.stats}>
          <Text style={styles.statText}>{pPhases.length} phases · {pTasks.length} tasks</Text>
          {running > 0 && <Text style={styles.running}>● {running} running</Text>}
          {waiting > 0 && <Text style={styles.waiting}>● {waiting} waiting</Text>}
          {done > 0 && <Text style={styles.done}>✓ {done} done</Text>}
        </View>
        {project.summary && (
          <Text style={styles.summary} numberOfLines={2}>
            {project.summary.overallProgress}
          </Text>
        )}
      </TouchableOpacity>
    )
  }

  return (
    <FlatList
      data={projects}
      renderItem={renderProject}
      keyExtractor={item => item.id}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <Text style={styles.title}>Projects</Text>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            프로젝트가 없습니다.{'\n'}데스크톱에서 프로젝트를 생성하세요.
          </Text>
        </View>
      }
    />
  )
}

const styles = StyleSheet.create({
  list: { padding: 16 },
  title: { fontSize: 22, fontWeight: '700', color: colors.textBright, marginBottom: 16 },
  card: {
    padding: 16,
    marginBottom: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
  },
  name: { fontSize: 16, fontWeight: '600', color: colors.textBright, marginBottom: 6 },
  path: { fontSize: 12, color: colors.textMuted, marginBottom: 10 },
  stats: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  statText: { fontSize: 12, color: colors.textMuted },
  running: { fontSize: 12, color: colors.green },
  waiting: { fontSize: 12, color: colors.yellow },
  done: { fontSize: 12, color: colors.greenDark },
  summary: { fontSize: 12, color: '#a1a1aa', marginTop: 8 },
  empty: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { color: colors.textDim, textAlign: 'center', lineHeight: 22 },
})

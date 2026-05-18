import React, { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors } from '../../styles/theme'
import type { SSHConfig } from '../../services/SSHTunnel'

type AuthMethod = 'password' | 'key'

/**
 * SetupScreen — SSH 접속 정보 입력 화면.
 *
 * 데스크톱 WorkAnywhere의 SSHConnectDialog와 동일한 필드.
 * 연결 성공 시 자동으로 Gateway 확인 → 프로젝트 리스트로 이동.
 */
export function SetupScreen({ onConnect, connecting, error }: {
  onConnect: (config: SSHConfig) => void
  connecting: boolean
  error: string | null
}) {
  const [host, setHost] = useState('')
  const [port, setPort] = useState('22')
  const [username, setUsername] = useState('')
  const [authMethod, setAuthMethod] = useState<AuthMethod>('password')
  const [password, setPassword] = useState('')
  const [privateKey, setPrivateKey] = useState('')

  const canConnect = host.trim().length > 0 && username.trim().length > 0 &&
    (authMethod === 'password' ? password.length > 0 : privateKey.length > 0)

  const handleConnect = () => {
    if (!canConnect || connecting) return
    onConnect({
      host: host.trim(),
      port: parseInt(port) || 22,
      username: username.trim(),
      authMethod,
      password: authMethod === 'password' ? password : undefined,
      privateKey: authMethod === 'key' ? privateKey : undefined,
    })
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>WorkAnywhere</Text>
        <Text style={styles.subtitle}>SSH로 서버에 연결합니다</Text>

        {/* Host */}
        <Text style={styles.label}>Host</Text>
        <TextInput
          value={host}
          onChangeText={setHost}
          placeholder="server.example.com"
          placeholderTextColor={colors.textDim}
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!connecting}
        />

        {/* Port + Username row */}
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Port</Text>
            <TextInput
              value={port}
              onChangeText={setPort}
              placeholder="22"
              placeholderTextColor={colors.textDim}
              style={styles.input}
              keyboardType="number-pad"
              editable={!connecting}
            />
          </View>
          <View style={{ flex: 2, marginLeft: 12 }}>
            <Text style={styles.label}>Username</Text>
            <TextInput
              value={username}
              onChangeText={setUsername}
              placeholder="yjlee"
              placeholderTextColor={colors.textDim}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!connecting}
            />
          </View>
        </View>

        {/* Auth method toggle */}
        <Text style={styles.label}>Authentication</Text>
        <View style={styles.toggleRow}>
          <TouchableOpacity
            style={[styles.toggle, authMethod === 'password' && styles.toggleActive]}
            onPress={() => setAuthMethod('password')}
            disabled={connecting}
          >
            <Text style={[styles.toggleText, authMethod === 'password' && styles.toggleTextActive]}>
              Password
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggle, authMethod === 'key' && styles.toggleActive]}
            onPress={() => setAuthMethod('key')}
            disabled={connecting}
          >
            <Text style={[styles.toggleText, authMethod === 'key' && styles.toggleTextActive]}>
              Private Key
            </Text>
          </TouchableOpacity>
        </View>

        {/* Password or Key input */}
        {authMethod === 'password' ? (
          <>
            <Text style={styles.label}>Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={colors.textDim}
              style={styles.input}
              secureTextEntry
              editable={!connecting}
            />
          </>
        ) : (
          <>
            <Text style={styles.label}>Private Key (PEM)</Text>
            <TextInput
              value={privateKey}
              onChangeText={setPrivateKey}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              placeholderTextColor={colors.textDim}
              style={[styles.input, styles.multiline]}
              multiline
              numberOfLines={4}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!connecting}
            />
          </>
        )}

        {/* Error message */}
        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Connect button */}
        <TouchableOpacity
          style={[styles.button, (!canConnect || connecting) && styles.buttonDisabled]}
          onPress={handleConnect}
          disabled={!canConnect || connecting}
          activeOpacity={0.7}
        >
          {connecting ? (
            <View style={styles.buttonContent}>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.buttonText}>  Connecting...</Text>
            </View>
          ) : (
            <Text style={[styles.buttonText, !canConnect && styles.buttonTextDisabled]}>
              Connect via SSH
            </Text>
          )}
        </TouchableOpacity>

        <Text style={styles.hint}>
          데스크톱 WorkAnywhere와 동일한 SSH 접속 정보를 입력하세요.{'\n'}
          Gateway가 서버에서 자동으로 확인됩니다.
        </Text>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    padding: 24,
    paddingTop: 48,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.textBright,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 32,
    textAlign: 'center',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    width: '100%',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 10,
    color: colors.textBright,
    fontSize: 15,
  },
  multiline: {
    minHeight: 80,
    textAlignVertical: 'top',
    fontFamily: 'monospace',
    fontSize: 12,
  },
  row: {
    flexDirection: 'row',
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  toggle: {
    flex: 1,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 10,
    alignItems: 'center',
  },
  toggleActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  toggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  toggleTextActive: {
    color: '#fff',
  },
  errorBox: {
    marginTop: 16,
    padding: 12,
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
    borderRadius: 10,
  },
  errorText: {
    fontSize: 13,
    color: colors.red,
  },
  button: {
    width: '100%',
    paddingVertical: 14,
    backgroundColor: colors.primary,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 24,
  },
  buttonDisabled: {
    backgroundColor: colors.border,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  buttonTextDisabled: {
    color: colors.textDim,
  },
  hint: {
    fontSize: 11,
    color: colors.textDim,
    textAlign: 'center',
    marginTop: 20,
    lineHeight: 18,
  },
})

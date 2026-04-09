import { useState } from 'react'
import type { ConnectionConfig } from '../../../shared/types'
import styles from './SSHConnectDialog.module.css'

interface Props {
  isOpen: boolean
  onConnect: (config: ConnectionConfig) => void
  onClose: () => void
  connecting: boolean
  error?: string
}

export function SSHConnectDialog({ isOpen, onConnect, onClose, connecting, error }: Props) {
  const [host, setHost] = useState('10.0.0.1')
  const [port, setPort] = useState('22')
  const [username, setUsername] = useState('yjlee')
  const [authMethod, setAuthMethod] = useState<'key' | 'password' | 'agent'>('key')
  const [keyPath, setKeyPath] = useState('~/.ssh/id_rsa')
  const [password, setPassword] = useState('')

  if (!isOpen) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const config: ConnectionConfig = {
      type: 'ssh',
      ssh: {
        host,
        port: parseInt(port),
        username,
        authMethod,
        keyPath: authMethod === 'key' ? keyPath : undefined,
      }
    }
    onConnect(config)
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h3>SSH Connection</h3>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.row}>
            <label>Host</label>
            <input value={host} onChange={e => setHost(e.target.value)} placeholder="hostname or IP" />
          </div>
          <div className={styles.row}>
            <label>Port</label>
            <input value={port} onChange={e => setPort(e.target.value)} type="number" />
          </div>
          <div className={styles.row}>
            <label>Username</label>
            <input value={username} onChange={e => setUsername(e.target.value)} />
          </div>
          <div className={styles.row}>
            <label>Auth</label>
            <select value={authMethod} onChange={e => setAuthMethod(e.target.value as any)}>
              <option value="key">SSH Key</option>
              <option value="password">Password</option>
              <option value="agent">SSH Agent</option>
            </select>
          </div>
          {authMethod === 'key' && (
            <div className={styles.row}>
              <label>Key Path</label>
              <input value={keyPath} onChange={e => setKeyPath(e.target.value)} placeholder="~/.ssh/id_rsa" />
            </div>
          )}
          {authMethod === 'password' && (
            <div className={styles.row}>
              <label>Password</label>
              <input value={password} onChange={e => setPassword(e.target.value)} type="password" />
            </div>
          )}

          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.actions}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>Cancel</button>
            <button type="submit" className={styles.connectBtn} disabled={connecting}>
              {connecting ? 'Connecting...' : 'Connect'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

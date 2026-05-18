/** WorkAnywhere 다크 테마 — 데스크톱과 동일한 색상 체계 */
export const colors = {
  bg: '#09090b',
  surface: '#18181b',
  surfaceHover: '#1f1f23',
  border: '#27272a',
  borderLight: '#3f3f46',

  text: '#d4d4d8',
  textBright: '#fafafa',
  textMuted: '#71717a',
  textDim: '#52525b',

  primary: '#4f46e5',
  primaryLight: '#6366f1',
  primaryBg: 'rgba(99,102,241,0.12)',
  primaryBorder: 'rgba(99,102,241,0.3)',

  green: '#4ade80',
  greenDark: '#22c55e',
  greenBg: 'rgba(34,197,94,0.08)',
  greenBorder: 'rgba(34,197,94,0.2)',

  yellow: '#facc15',
  yellowBg: '#2d2a1e',

  red: '#ef4444',
  redLight: '#fca5a5',
  redBg: '#7f1d1d',
  redBgLight: 'rgba(239,68,68,0.08)',

  blue: '#60a5fa',
  blueBg: '#1a1e2e',

  indigo: '#818cf8',
  indigoBg: '#1e1b4b',
  indigoBorder: '#312e81',
} as const

export const STATUS_META: Record<string, { color: string; bg: string; label: string }> = {
  idle:      { color: '#888',    bg: '#2a2a2e', label: '대기' },
  queued:    { color: '#c8a832', bg: '#2d2a1e', label: '대기열' },
  running:   { color: '#4ade80', bg: '#1a2e1a', label: '실행 중' },
  waiting:   { color: '#facc15', bg: '#2e2a1a', label: '입력 대기' },
  review:    { color: '#60a5fa', bg: '#1a1e2e', label: '검토' },
  completed: { color: '#22c55e', bg: '#1a2e1a', label: '완료' },
  failed:    { color: '#ef4444', bg: '#2e1a1a', label: '실패' },
  active:    { color: '#4ade80', bg: '#1a2e1a', label: '활성' },
  paused:    { color: '#c8a832', bg: '#2d2a1e', label: '일시정지' },
}

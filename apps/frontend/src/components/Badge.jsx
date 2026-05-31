const PRESETS = {
  'var(--color-success)': { color: '#34c759', bg: 'rgba(52, 199, 89, 0.12)' },
  'var(--color-danger)': { color: '#ff3b30', bg: 'rgba(255, 59, 48, 0.12)' },
  'var(--color-warning)': { color: '#ff9500', bg: 'rgba(255, 149, 0, 0.12)' },
  'var(--color-primary)': { color: '#007aff', bg: 'rgba(0, 122, 255, 0.12)' },
  'var(--color-text-muted)': { color: '#8e8e93', bg: 'rgba(142, 142, 147, 0.12)' },
}

export default function Badge({ label, color }) {
  const preset = PRESETS[color]
  const resolvedColor = preset ? preset.color : (color || '#8e8e93')
  const resolvedBg = preset ? preset.bg : `${color}1f`

  return (
    <span style={{
      fontSize: '11px',
      fontWeight: 600,
      padding: '3px 10px',
      borderRadius: '100px',
      background: resolvedBg,
      color: resolvedColor,
      letterSpacing: '0.2px',
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  )
}

export default function Badge({ label, color, bg }) {
  return (
    <span style={{
      fontSize: 'var(--font-xs)',
      fontWeight: 700,
      letterSpacing: '0.04em',
      padding: '0.15rem 0.4rem',
      borderRadius: '4px',
      background: bg || `${color}1a`,
      color: color || 'var(--color-text-muted)',
      textAlign: 'center',
      flexShrink: 0,
    }}>
      {label}
    </span>
  )
}

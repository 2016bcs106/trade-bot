export default function Toggle({ label, enabled, onToggle }) {
  return (
    <div style={styles.row}>
      <span style={styles.label}>{label}</span>
      <div onClick={onToggle} style={{ ...styles.track, background: enabled ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}>
        <div style={{ ...styles.thumb, transform: enabled ? 'translateX(20px)' : 'translateX(0)' }} />
      </div>
    </div>
  )
}

const styles = {
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 0',
    minHeight: '44px',
  },
  label: {
    fontSize: 'var(--font-body)',
    color: 'var(--color-text)',
  },
  track: {
    width: '51px',
    height: '31px',
    borderRadius: '16px',
    padding: '2px',
    cursor: 'pointer',
    transition: 'background 0.25s ease',
  },
  thumb: {
    width: '27px',
    height: '27px',
    borderRadius: '14px',
    background: '#fff',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
    transition: 'transform 0.25s ease',
  },
}

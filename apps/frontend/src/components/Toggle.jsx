import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faToggleOn, faToggleOff } from '@fortawesome/free-solid-svg-icons'

export default function Toggle({ label, enabled, onToggle }) {
  return (
    <div style={styles.row}>
      <span style={styles.label}>{label}</span>
      <button onClick={onToggle} style={styles.button}>
        <FontAwesomeIcon
          icon={enabled ? faToggleOn : faToggleOff}
          style={{ color: enabled ? 'var(--color-success)' : 'var(--color-text-muted)' }}
        />
      </button>
    </div>
  )
}

const styles = {
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 'var(--space-sm) 0',
  },
  label: {
    fontSize: 'var(--font-md)',
    fontWeight: 500,
    color: 'var(--color-text)',
  },
  button: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '1.3rem',
    padding: 0,
  },
}

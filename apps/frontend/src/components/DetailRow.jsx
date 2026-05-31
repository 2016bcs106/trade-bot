export default function DetailRow({ label, value }) {
  if (value === undefined || value === null || value === '') return null
  return (
    <div style={styles.row}>
      <span style={styles.label}>{label}</span>
      <span style={styles.value}>{value}</span>
    </div>
  )
}

const styles = {
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '11px 0',
    minHeight: '44px',
    borderBottom: '1px solid var(--color-border)',
  },
  label: {
    fontSize: 'var(--font-body)',
    color: 'var(--color-text)',
  },
  value: {
    fontSize: 'var(--font-body)',
    color: 'var(--color-text-muted)',
  },
}

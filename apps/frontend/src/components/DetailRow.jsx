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
    padding: 'var(--space-xs) 0',
  },
  label: {
    fontSize: 'var(--font-md)',
    color: 'var(--color-text-muted)',
    fontWeight: 500,
  },
  value: {
    fontSize: 'var(--font-md)',
    color: 'var(--color-text)',
    fontWeight: 600,
  },
}

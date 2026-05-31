export default function PageHeader({ title, right }) {
  return (
    <div style={styles.header}>
      <h1 style={styles.title}>{title}</h1>
      {right && <div>{right}</div>}
    </div>
  )
}

const styles = {
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 'var(--space-xl)',
  },
  title: {
    fontSize: 'var(--font-largetitle)',
    fontWeight: 700,
    color: 'var(--color-text)',
    letterSpacing: '-0.5px',
  },
}

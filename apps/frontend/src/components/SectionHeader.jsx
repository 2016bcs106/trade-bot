export default function SectionHeader({ children, style }) {
  return (
    <div style={{ ...styles.header, ...style }}>
      {children}
    </div>
  )
}

const styles = {
  header: {
    fontSize: 'var(--font-base)',
    fontWeight: 700,
    color: 'var(--color-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: 'var(--space-sm)',
    marginTop: 'var(--space-md)',
  },
}

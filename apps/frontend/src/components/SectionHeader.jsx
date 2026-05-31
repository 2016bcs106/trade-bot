export default function SectionHeader({ children, style }) {
  return (
    <div style={{ ...styles.header, ...style }}>
      {children}
    </div>
  )
}

const styles = {
  header: {
    fontSize: 'var(--font-footnote)',
    fontWeight: 400,
    color: 'var(--color-text-muted)',
    textTransform: 'uppercase',
    paddingLeft: 'var(--space-lg)',
    marginBottom: '6px',
    marginTop: 'var(--space-xl)',
  },
}

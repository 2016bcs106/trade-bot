export default function Page({ children, style }) {
  return (
    <div style={{ ...styles.page, ...style }}>
      {children}
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    background: 'var(--color-bg)',
    padding: 'var(--space-lg)',
    paddingBottom: '6rem',
  },
}

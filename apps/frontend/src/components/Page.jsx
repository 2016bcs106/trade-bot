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
    paddingTop: 'var(--space-lg)',
    paddingBottom: '100px',
    paddingLeft: 'var(--space-lg)',
    paddingRight: 'var(--space-lg)',
  },
}

export default function BottomSheet({ title, isOpen, onClose, children }) {
  if (!isOpen) return null

  return (
    <>
      <div onClick={onClose} style={styles.overlay} />
      <div style={styles.sheet}>
        <div style={styles.header}>
          <div style={styles.handle} />
          {title && <span style={styles.title}>{title}</span>}
        </div>
        <div style={styles.body}>
          {children}
        </div>
      </div>
    </>
  )
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.4)',
    zIndex: 2000,
  },
  sheet: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: '70vh',
    background: 'var(--color-card)',
    borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
    zIndex: 2001,
    display: 'flex',
    flexDirection: 'column',
    boxShadow: 'var(--shadow-overlay)',
    animation: 'slide-up 0.25s ease-out',
  },
  header: {
    padding: 'var(--space-md)',
    textAlign: 'center',
    borderBottom: '1px solid var(--color-border)',
    flexShrink: 0,
  },
  handle: {
    width: '36px',
    height: '4px',
    borderRadius: '2px',
    background: 'var(--color-text-muted)',
    margin: '0 auto var(--space-sm)',
  },
  title: {
    fontWeight: 600,
    fontSize: 'var(--font-md)',
    color: 'var(--color-text)',
  },
  body: {
    overflowY: 'auto',
    flex: 1,
  },
}

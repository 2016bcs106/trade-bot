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
    background: 'rgba(0,0,0,0.32)',
    zIndex: 2000,
    animation: 'fade-in 0.2s ease',
  },
  sheet: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    minHeight: '50vh',
    maxHeight: '85vh',
    background: 'var(--color-card)',
    borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
    zIndex: 2001,
    display: 'flex',
    flexDirection: 'column',
    boxShadow: 'var(--shadow-overlay)',
    animation: 'slide-up 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
  },
  header: {
    padding: '12px 16px 8px',
    textAlign: 'center',
    flexShrink: 0,
  },
  handle: {
    width: '36px',
    height: '5px',
    borderRadius: '3px',
    background: 'var(--color-text-tertiary)',
    opacity: 0.4,
    margin: '0 auto 10px',
  },
  title: {
    fontWeight: 600,
    fontSize: 'var(--font-subhead)',
    color: 'var(--color-text)',
  },
  body: {
    overflowY: 'auto',
    flex: 1,
    WebkitOverflowScrolling: 'touch',
  },
}

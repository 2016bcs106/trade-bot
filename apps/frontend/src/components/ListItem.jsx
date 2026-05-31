import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

export default function ListItem({ icon, iconBg, title, subtitle, right, isLast, onClick }) {
  return (
    <div style={{ ...styles.item, ...(isLast ? {} : styles.bordered) }} onClick={onClick}>
      {icon && (
        <div style={{ ...styles.iconCircle, background: iconBg || 'var(--color-info)' }}>
          <FontAwesomeIcon icon={icon} style={{ color: '#fff' }} />
        </div>
      )}
      <div style={styles.content}>
        <div style={styles.title}>{title}</div>
        {subtitle && <div style={styles.subtitle}>{subtitle}</div>}
      </div>
      {right && <div style={styles.right}>{right}</div>}
    </div>
  )
}

const styles = {
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-md)',
    padding: 'var(--space-md) var(--space-lg)',
    cursor: 'pointer',
  },
  bordered: {
    borderBottom: '1px solid var(--color-border)',
  },
  iconCircle: {
    width: '2rem',
    height: '2rem',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 'var(--font-base)',
    flexShrink: 0,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 'var(--font-md)',
    fontWeight: 600,
    color: 'var(--color-text)',
  },
  subtitle: {
    fontSize: 'var(--font-sm)',
    color: 'var(--color-text-muted)',
    marginTop: '2px',
  },
  right: {
    flexShrink: 0,
  },
}

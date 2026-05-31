import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronRight } from '@fortawesome/free-solid-svg-icons'

export default function ListItem({ icon, iconColor, title, subtitle, right, isLast, onClick, showChevron }) {
  return (
    <div style={{ ...styles.item, ...(isLast ? {} : styles.bordered) }} onClick={onClick}>
      {icon && (
        <div style={{ ...styles.iconCircle, background: iconColor || 'var(--color-primary)' }}>
          <FontAwesomeIcon icon={icon} style={{ color: '#fff', fontSize: '0.8rem' }} />
        </div>
      )}
      <div style={styles.content}>
        <div style={styles.title}>{title}</div>
        {subtitle && <div style={styles.subtitle}>{subtitle}</div>}
      </div>
      {right && <div style={styles.right}>{right}</div>}
      {showChevron && <FontAwesomeIcon icon={faChevronRight} style={styles.chevron} />}
    </div>
  )
}

const styles = {
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-md)',
    padding: '14px var(--space-lg)',
    cursor: 'pointer',
    minHeight: '44px',
  },
  bordered: {
    borderBottom: '1px solid var(--color-border)',
  },
  iconCircle: {
    width: '30px',
    height: '30px',
    borderRadius: '7px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 'var(--font-body)',
    fontWeight: 400,
    color: 'var(--color-text)',
  },
  subtitle: {
    fontSize: 'var(--font-footnote)',
    color: 'var(--color-text-muted)',
    marginTop: '2px',
  },
  right: {
    flexShrink: 0,
    fontSize: 'var(--font-subhead)',
    color: 'var(--color-text-muted)',
  },
  chevron: {
    fontSize: '0.7rem',
    color: 'var(--color-text-tertiary)',
    marginLeft: 'var(--space-sm)',
  },
}

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

export default function EmptyState({ icon, title, subtitle }) {
  return (
    <div style={styles.container}>
      {icon && <FontAwesomeIcon icon={icon} style={styles.icon} />}
      <span style={styles.title}>{title}</span>
      {subtitle && <span style={styles.subtitle}>{subtitle}</span>}
    </div>
  )
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px var(--space-lg)',
    gap: 'var(--space-sm)',
  },
  icon: {
    fontSize: '2.5rem',
    color: 'var(--color-text-tertiary)',
    marginBottom: 'var(--space-sm)',
  },
  title: {
    fontSize: 'var(--font-body)',
    color: 'var(--color-text-muted)',
    fontWeight: 500,
  },
  subtitle: {
    fontSize: 'var(--font-footnote)',
    color: 'var(--color-text-tertiary)',
  },
}

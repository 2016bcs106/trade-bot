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
    padding: '4rem var(--space-lg)',
    gap: 'var(--space-md)',
  },
  icon: {
    fontSize: '2rem',
    color: 'var(--color-text-muted)',
  },
  title: {
    fontSize: 'var(--font-md)',
    color: 'var(--color-text-muted)',
  },
  subtitle: {
    fontSize: 'var(--font-sm)',
    color: 'var(--color-text-muted)',
  },
}

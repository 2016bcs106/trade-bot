import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

export default function PageHeader({ icon, title, right }) {
  return (
    <div style={styles.header}>
      <div style={styles.left}>
        {icon && <FontAwesomeIcon icon={icon} style={styles.icon} />}
        <span style={styles.title}>{title}</span>
      </div>
      {right && <div>{right}</div>}
    </div>
  )
}

const styles = {
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 'var(--space-xl)',
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
  },
  icon: {
    fontSize: 'var(--font-xl)',
    color: 'var(--color-primary)',
  },
  title: {
    fontSize: 'var(--font-2xl)',
    fontWeight: 700,
    color: 'var(--color-text)',
  },
}

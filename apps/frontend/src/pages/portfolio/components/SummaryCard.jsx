import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronRight } from '@fortawesome/free-solid-svg-icons'
import Card from '../../../components/Card'

export default function SummaryCard({ title, stats, onClick }) {
  return (
    <Card style={styles.card} onClick={onClick}>
      <div style={styles.header}>
        <span style={styles.title}>{title}</span>
        {onClick && <FontAwesomeIcon icon={faChevronRight} style={styles.chevron} />}
      </div>
      <div style={styles.statsRow}>
        {stats.map((stat) => (
          <div key={stat.label} style={styles.stat}>
            <span style={{ ...styles.statValue, color: stat.color || 'var(--color-text)' }}>{stat.value}</span>
            <span style={styles.statLabel}>{stat.label}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

const styles = {
  card: {
    cursor: 'pointer',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 'var(--space-md)',
  },
  title: {
    fontSize: 'var(--font-subhead)',
    fontWeight: 600,
    color: 'var(--color-text)',
  },
  chevron: {
    fontSize: '0.8rem',
    color: 'var(--color-text-tertiary)',
  },
  statsRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-md)',
  },
  stat: {
    flex: '1 1 40%',
    display: 'flex',
    flexDirection: 'column',
  },
  statValue: {
    fontSize: 'var(--font-body)',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  statLabel: {
    fontSize: 'var(--font-caption)',
    color: 'var(--color-text-muted)',
    marginTop: '2px',
  },
}

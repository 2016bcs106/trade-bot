import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronRight, faCaretUp, faCaretDown } from '@fortawesome/free-solid-svg-icons'
import Card from '../../../components/Card'
import { formatCurrency, formatSignedCurrency, formatSigned, changeColor, changeBgColor } from '../utils'

export default function SummaryCard({ icon, iconColor, title, value, change, secondaryStats, onClick }) {
  return (
    <Card style={onClick ? styles.card : undefined} onClick={onClick}>
      <div style={styles.header}>
        <div style={styles.titleRow}>
          {icon && (
            <div style={{ ...styles.iconCircle, background: iconColor || 'var(--color-primary)' }}>
              <FontAwesomeIcon icon={icon} style={styles.icon} />
            </div>
          )}
          <span style={styles.title}>{title}</span>
        </div>
        {onClick && <FontAwesomeIcon icon={faChevronRight} style={styles.chevron} />}
      </div>

      <div style={styles.value}>{formatCurrency(value)}</div>

      {change && (
        <div style={styles.changeRow}>
          <span style={{ ...styles.changePill, background: changeBgColor(change.value), color: changeColor(change.value) }}>
            <FontAwesomeIcon icon={change.value >= 0 ? faCaretUp : faCaretDown} />
            {formatSignedCurrency(change.value)} ({formatSigned(change.pct)}%)
          </span>
          <span style={styles.changeLabel}>{change.label}</span>
        </div>
      )}

      {secondaryStats && (
        <div style={styles.statsRow}>
          {secondaryStats.map((stat) => (
            <div key={stat.label} style={styles.stat}>
              <span style={styles.statValue}>{stat.value}</span>
              <span style={styles.statLabel}>{stat.label}</span>
            </div>
          ))}
        </div>
      )}
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
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
  },
  iconCircle: {
    width: '28px',
    height: '28px',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  icon: {
    color: '#fff',
    fontSize: '0.8rem',
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
  value: {
    fontSize: 'var(--font-title1)',
    fontWeight: 700,
    color: 'var(--color-text)',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '-0.5px',
  },
  changeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
    marginTop: '6px',
  },
  changePill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px 8px',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--font-caption)',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  changeLabel: {
    fontSize: 'var(--font-caption)',
    color: 'var(--color-text-muted)',
  },
  statsRow: {
    display: 'flex',
    gap: 'var(--space-xl)',
    marginTop: 'var(--space-lg)',
    paddingTop: 'var(--space-md)',
    borderTop: '1px solid var(--color-border)',
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
  },
  statValue: {
    fontSize: 'var(--font-body)',
    fontWeight: 600,
    color: 'var(--color-text)',
    fontVariantNumeric: 'tabular-nums',
  },
  statLabel: {
    fontSize: 'var(--font-caption)',
    color: 'var(--color-text-muted)',
    marginTop: '2px',
  },
}

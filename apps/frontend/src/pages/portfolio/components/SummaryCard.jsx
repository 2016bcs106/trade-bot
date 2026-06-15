import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronRight, faCaretUp, faCaretDown } from '@fortawesome/free-solid-svg-icons'
import Card from '../../../components/Card'
import { formatCurrency, formatSignedCurrency, formatSigned, changeColor, changeBgColor } from '../utils'

export default function SummaryCard({ value, changes, secondaryStats, onClick }) {
  return (
    <Card style={{ ...styles.card, ...(onClick ? styles.clickable : {}) }} onClick={onClick}>
      {onClick && <FontAwesomeIcon icon={faChevronRight} style={styles.chevron} />}

      <div style={styles.value}>{formatCurrency(value)}</div>

      {changes?.map((change) => (
        <div key={change.label} style={styles.changeRow}>
          <span style={{ ...styles.changePill, background: changeBgColor(change.value), color: changeColor(change.value) }}>
            <FontAwesomeIcon icon={change.value >= 0 ? faCaretUp : faCaretDown} />
            {formatSignedCurrency(change.value)} ({formatSigned(change.pct)}%)
          </span>
          <span style={styles.changeLabel}>{change.label}</span>
        </div>
      ))}

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
    position: 'relative',
  },
  clickable: {
    cursor: 'pointer',
  },
  chevron: {
    position: 'absolute',
    top: 'var(--space-lg)',
    right: 'var(--space-lg)',
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
    justifyContent: 'space-between',
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

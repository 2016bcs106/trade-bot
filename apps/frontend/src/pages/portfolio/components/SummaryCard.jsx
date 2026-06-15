import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronRight } from '@fortawesome/free-solid-svg-icons'
import Card from '../../../components/Card'
import { formatCurrency, formatSignedCurrency, formatSigned, changeColor } from '../utils'

export default function SummaryCard({ value, changes, secondaryStats, onClick }) {
  const rowCount = Math.max(secondaryStats?.length ?? 0, changes?.length ?? 0)

  return (
    <Card style={{ ...styles.card, ...(onClick ? styles.clickable : {}) }} onClick={onClick}>
      <div style={styles.topRow}>
        <div style={styles.value}>{formatCurrency(value)}</div>
        {onClick && <FontAwesomeIcon icon={faChevronRight} style={styles.chevron} />}
      </div>

      <div style={styles.statsBlock}>
        {Array.from({ length: rowCount }, (_, i) => {
          const stat = secondaryStats?.[i]
          const change = changes?.[i]
          return (
            <div key={i} style={styles.statRow}>
              <div style={styles.statCol}>
                {stat && (
                  <>
                    <span style={styles.label}>{stat.label}</span>
                    <span style={styles.statValue}>{stat.value}</span>
                  </>
                )}
              </div>
              <div style={{ ...styles.statCol, ...styles.statColRight }}>
                {change && (
                  <>
                    <span style={styles.label}>{change.label}</span>
                    <span style={{ ...styles.changeValue, color: changeColor(change.value) }}>
                      {formatSignedCurrency(change.value)} ({formatSigned(change.pct)}%)
                    </span>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

const styles = {
  card: {
    display: 'flex',
    flexDirection: 'column',
  },
  clickable: {
    cursor: 'pointer',
  },
  topRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  value: {
    fontSize: 'var(--font-title1)',
    fontWeight: 700,
    color: 'var(--color-text)',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '-0.5px',
  },
  chevron: {
    fontSize: '0.9rem',
    color: 'var(--color-text-tertiary)',
  },
  statsBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-md)',
    marginTop: 'var(--space-lg)',
    paddingTop: 'var(--space-md)',
    borderTop: '1px solid var(--color-border)',
  },
  statRow: {
    display: 'flex',
    justifyContent: 'space-between',
  },
  statCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  statColRight: {
    alignItems: 'flex-end',
    textAlign: 'right',
  },
  label: {
    fontSize: 'var(--font-caption)',
    color: 'var(--color-text-muted)',
  },
  statValue: {
    fontSize: 'var(--font-body)',
    fontWeight: 600,
    color: 'var(--color-text)',
    fontVariantNumeric: 'tabular-nums',
  },
  changeValue: {
    fontSize: 'var(--font-body)',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
}

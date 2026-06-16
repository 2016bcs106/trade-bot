import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronRight } from '@fortawesome/free-solid-svg-icons'
import Card from '../../../components/Card'
import { formatCurrencyCompact, formatSignedCurrencyCompact, formatSigned, changeColor } from '../utils'

export default function SummaryCard({ currentValue, stockCount, stockLabel = 'stocks', left, right, onClick }) {
  return (
    <Card style={{ ...styles.card, ...(onClick ? styles.clickable : {}) }} onClick={onClick}>
      <div style={styles.row1}>
        <div style={styles.valueBlock}>
          <span style={styles.valueLabel}>Current Value</span>
          <span style={styles.currentValue}>{formatCurrencyCompact(currentValue)}</span>
        </div>
        <div style={styles.stockCount}>
          <span style={styles.stockCountText}>{stockCount} {stockLabel}</span>
          {onClick && <FontAwesomeIcon icon={faChevronRight} style={styles.chevron} />}
        </div>
      </div>
      <div style={styles.row2}>
        <div style={styles.stat}>
          <span style={styles.label}>{left.label}</span>
          <span style={{ ...styles.change, color: changeColor(left.value) }}>
            {formatSignedCurrencyCompact(left.value)} ({formatSigned(left.pct)}%)
          </span>
        </div>
        <div style={{ ...styles.stat, ...styles.statRight }}>
          <span style={styles.label}>{right.label}</span>
          {right.pct != null
            ? <span style={{ ...styles.change, color: changeColor(right.value) }}>{formatSignedCurrencyCompact(right.value)} ({formatSigned(right.pct)}%)</span>
            : <span style={styles.change}>{formatCurrencyCompact(right.value)}</span>
          }
        </div>
      </div>
    </Card>
  )
}

const styles = {
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-md)',
  },
  clickable: {
    cursor: 'pointer',
  },
  row1: {
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  valueBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  valueLabel: {
    fontSize: 'var(--font-caption)',
    color: 'var(--color-text-muted)',
  },
  currentValue: {
    fontSize: 'var(--font-title1)',
    fontWeight: 700,
    color: 'var(--color-text)',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '-0.5px',
  },
  stockCount: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  stockCountText: {
    fontSize: 'var(--font-caption)',
    color: 'var(--color-text-muted)',
  },
  chevron: {
    fontSize: '0.75rem',
    color: 'var(--color-text-tertiary)',
  },
  row2: {
    display: 'flex',
    justifyContent: 'space-between',
    paddingTop: 'var(--space-sm)',
    borderTop: '1px solid var(--color-border)',
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  statRight: {
    alignItems: 'flex-end',
    textAlign: 'right',
  },
  label: {
    fontSize: 'var(--font-caption)',
    color: 'var(--color-text-muted)',
  },
  change: {
    fontSize: 'var(--font-body)',
    fontWeight: 600,
    color: 'var(--color-text)',
    fontVariantNumeric: 'tabular-nums',
  },
}

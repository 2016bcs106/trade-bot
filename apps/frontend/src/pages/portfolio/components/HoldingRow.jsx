import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBriefcase } from '@fortawesome/free-solid-svg-icons'
import { formatCurrency, formatSignedCurrency, formatSigned, changeColor } from '../utils'

export default function HoldingRow({ item, changes, isLast }) {
  const [dayChange, netChange] = changes ?? []

  return (
    <div style={{ ...styles.row, ...(isLast ? {} : styles.bordered) }}>
      <div style={{ ...styles.accent, background: dayChange ? changeColor(dayChange.value) : 'var(--color-border)' }} />
      <div style={styles.main}>
        <div style={styles.line}>
          <span style={styles.symbol}>{item.symbol}</span>
          <span style={styles.value}>{formatCurrency(item.currentValue)}</span>
        </div>
        <div style={styles.line}>
          <span style={styles.subtitle}>
            <FontAwesomeIcon icon={faBriefcase} style={styles.subtitleIcon} />
            {item.quantity} x {formatCurrency(item.avgPrice)}
          </span>
          {dayChange && (
            <span style={{ ...styles.changeText, color: changeColor(dayChange.value) }}>
              {formatSignedCurrency(dayChange.value)} ({formatSigned(dayChange.pct)}%)
            </span>
          )}
        </div>
        {netChange && (
          <div style={styles.line}>
            <span style={styles.subtitle}>Net return</span>
            <span style={{ ...styles.changeText, color: changeColor(netChange.value) }}>
              {formatSignedCurrency(netChange.value)} ({formatSigned(netChange.pct)}%)
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

const styles = {
  row: {
    display: 'flex',
    alignItems: 'stretch',
    gap: 'var(--space-md)',
    padding: '14px var(--space-lg)',
  },
  bordered: {
    borderBottom: '1px solid var(--color-border)',
  },
  accent: {
    width: '3px',
    borderRadius: '2px',
    flexShrink: 0,
  },
  main: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  line: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-sm)',
  },
  symbol: {
    fontSize: 'var(--font-body)',
    fontWeight: 600,
    color: 'var(--color-text)',
  },
  value: {
    fontSize: 'var(--font-body)',
    fontWeight: 700,
    color: 'var(--color-text)',
    fontVariantNumeric: 'tabular-nums',
  },
  subtitle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: 'var(--font-footnote)',
    color: 'var(--color-text-muted)',
    fontVariantNumeric: 'tabular-nums',
  },
  subtitleIcon: {
    fontSize: '0.75em',
    color: 'var(--color-text-tertiary)',
  },
  changeText: {
    fontSize: 'var(--font-footnote)',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
}

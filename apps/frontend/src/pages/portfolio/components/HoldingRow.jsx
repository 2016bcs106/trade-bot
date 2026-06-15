import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCaretUp, faCaretDown } from '@fortawesome/free-solid-svg-icons'
import { formatCurrency, formatSignedCurrency, formatSigned, changeColor, changeBgColor } from '../utils'

export default function HoldingRow({ item, change, isLast }) {
  return (
    <div style={{ ...styles.row, ...(isLast ? {} : styles.bordered) }}>
      <div style={styles.avatar}>{item.symbol.slice(0, 2)}</div>
      <div style={styles.main}>
        <div style={styles.line}>
          <span style={styles.symbol}>{item.symbol}</span>
          <span style={styles.value}>{formatCurrency(item.currentValue)}</span>
        </div>
        <div style={styles.line}>
          <span style={styles.subtitle}>{item.quantity} @ {formatCurrency(item.avgPrice)}</span>
          {change && (
            <span style={{ ...styles.changePill, background: changeBgColor(change.value), color: changeColor(change.value) }}>
              <FontAwesomeIcon icon={change.value >= 0 ? faCaretUp : faCaretDown} />
              {formatSignedCurrency(change.value)} ({formatSigned(change.pct)}%)
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

const styles = {
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-md)',
    padding: '12px var(--space-lg)',
    minHeight: '64px',
  },
  bordered: {
    borderBottom: '1px solid var(--color-border)',
  },
  avatar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    background: 'var(--color-primary-light)',
    color: 'var(--color-primary)',
    fontSize: 'var(--font-caption)',
    fontWeight: 700,
    flexShrink: 0,
  },
  main: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  line: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-sm)',
  },
  symbol: {
    fontSize: 'var(--font-body)',
    fontWeight: 500,
    color: 'var(--color-text)',
  },
  value: {
    fontSize: 'var(--font-body)',
    fontWeight: 600,
    color: 'var(--color-text)',
    fontVariantNumeric: 'tabular-nums',
  },
  subtitle: {
    fontSize: 'var(--font-footnote)',
    color: 'var(--color-text-muted)',
    fontVariantNumeric: 'tabular-nums',
  },
  changePill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px 6px',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--font-caption)',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
}

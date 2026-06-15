import { formatCurrency, formatSignedCurrency, formatSigned, changeColor } from '../utils'

export default function HoldingRow({ item, change, isLast }) {
  return (
    <div style={{ ...styles.row, ...(isLast ? {} : styles.bordered) }}>
      <div style={styles.avatar}>{item.symbol.slice(0, 2)}</div>
      <div style={styles.left}>
        <span style={styles.symbol}>{item.symbol}</span>
        <span style={styles.subtitle}>{item.quantity} @ {formatCurrency(item.avgPrice)}</span>
      </div>
      <div style={styles.col}>
        <span style={styles.value}>{formatCurrency(item.currentValue)}</span>
        <span style={styles.subtitle}>Inv {formatCurrency(item.investedValue)}</span>
      </div>
      {change && (
        <div style={styles.col}>
          <span style={{ ...styles.value, color: changeColor(change.value) }}>
            {formatSignedCurrency(change.value)}
          </span>
          <span style={{ ...styles.subtitle, color: changeColor(change.value) }}>
            {formatSigned(change.pct)}%
          </span>
        </div>
      )}
    </div>
  )
}

const styles = {
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-md)',
    padding: '14px var(--space-lg)',
    minHeight: '56px',
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
  left: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  col: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    textAlign: 'right',
    flexShrink: 0,
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
    marginTop: '2px',
    fontVariantNumeric: 'tabular-nums',
  },
}

import { formatCurrency, formatCurrencyCompact, formatSignedCurrencyCompact, formatSigned, changeColor } from '../utils'

export default function HoldingRow({ item, changes, isLast }) {
  const pnl = changes?.[changes.length - 1]

  return (
    <div style={{ ...styles.row, ...(isLast ? {} : styles.bordered) }}>
      <div style={{ ...styles.accent, background: pnl ? changeColor(pnl.value) : 'var(--color-border)' }} />
      <div style={styles.main}>
        <div style={styles.line}>
          <span style={styles.symbol}>{item.symbol}</span>
          <span style={styles.value}>{formatCurrencyCompact(item.currentValue)}</span>
        </div>
        <div style={styles.line}>
          <span style={styles.subtitle}>{item.quantity} × {formatCurrency(item.avgPrice)}</span>
          {pnl && (
            <span style={{ ...styles.pnl, color: changeColor(pnl.value) }}>
              {formatSignedCurrencyCompact(pnl.value)} ({formatSigned(pnl.pct)}%)
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
    alignItems: 'stretch',
    gap: 'var(--space-md)',
    padding: '12px var(--space-lg)',
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
    gap: '4px',
  },
  line: {
    display: 'flex',
    alignItems: 'baseline',
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
    fontWeight: 600,
    color: 'var(--color-text)',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  subtitle: {
    fontSize: 'var(--font-footnote)',
    color: 'var(--color-text-muted)',
    fontVariantNumeric: 'tabular-nums',
  },
  pnl: {
    fontSize: 'var(--font-footnote)',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
}

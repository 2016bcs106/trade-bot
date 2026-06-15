export default function HoldingRow({ item, change, isLast }) {
  return (
    <div style={{ ...styles.row, ...(isLast ? {} : styles.bordered) }}>
      <div style={styles.left}>
        <span style={styles.symbol}>{item.symbol}</span>
        <span style={styles.subtitle}>{item.quantity} @ {item.avgPrice.toFixed(2)}</span>
      </div>
      <div style={styles.col}>
        <span style={styles.value}>{item.currentValue.toFixed(2)}</span>
        <span style={styles.subtitle}>Inv {item.investedValue.toFixed(2)}</span>
      </div>
      {change && (
        <div style={styles.col}>
          <span style={{ ...styles.value, color: change.value >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
            {change.value >= 0 ? '+' : ''}{change.value.toFixed(2)}
          </span>
          <span style={{ ...styles.subtitle, color: change.value >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
            {change.value >= 0 ? '+' : ''}{change.pct.toFixed(2)}%
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

import { formatCurrency, formatSignedCurrency, formatSigned, changeColor } from '../utils'

export default function HoldingRow({ item, changes, isLast }) {
  const [primaryChange] = changes ?? []

  return (
    <div style={{ ...styles.row, ...(isLast ? {} : styles.bordered) }}>
      <div style={{ ...styles.accent, background: primaryChange ? changeColor(primaryChange.value) : 'var(--color-border)' }} />
      <div style={styles.main}>
        <div style={styles.line}>
          <span style={styles.symbol}>{item.symbol}</span>
          <span style={styles.subtitle}>{item.quantity} @ {formatCurrency(item.avgPrice)}</span>
        </div>

        <div style={styles.grid}>
          <div style={styles.cell}>
            <span style={styles.label}>Invested</span>
            <span style={styles.statValue}>{formatCurrency(item.investedValue)}</span>
          </div>
          <div style={{ ...styles.cell, ...styles.cellRight }}>
            <span style={styles.label}>Current Value</span>
            <span style={styles.statValue}>{formatCurrency(item.currentValue)}</span>
          </div>

          {changes?.map((change, i) => (
            <div key={change.label} style={{ ...styles.cell, ...(i % 2 === 1 ? styles.cellRight : {}) }}>
              <span style={styles.label}>{change.label}</span>
              <span style={{ ...styles.statValue, color: changeColor(change.value) }}>
                {formatSignedCurrency(change.value)} ({formatSigned(change.pct)}%)
              </span>
            </div>
          ))}
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
  subtitle: {
    fontSize: 'var(--font-footnote)',
    color: 'var(--color-text-muted)',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    rowGap: '10px',
    columnGap: 'var(--space-sm)',
    marginTop: '10px',
  },
  cell: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  cellRight: {
    alignItems: 'flex-end',
    textAlign: 'right',
  },
  label: {
    fontSize: 'var(--font-caption)',
    color: 'var(--color-text-muted)',
  },
  statValue: {
    fontSize: 'var(--font-footnote)',
    fontWeight: 600,
    color: 'var(--color-text)',
    fontVariantNumeric: 'tabular-nums',
  },
}

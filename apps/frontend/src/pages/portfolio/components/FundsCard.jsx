import Card from '../../../components/Card'
import { formatCurrencyCompact } from '../utils'

export default function FundsCard({ funds }) {
  if (!funds) return null

  return (
    <Card style={styles.card}>
      <div style={styles.main}>
        <span style={styles.label}>Available Balance</span>
        <span style={styles.value}>{formatCurrencyCompact(funds.availableBalance)}</span>
      </div>
      <div style={styles.divider} />
      <div style={styles.row}>
        <div style={styles.stat}>
          <span style={styles.statLabel}>Opening</span>
          <span style={styles.statValue}>{formatCurrencyCompact(funds.openingBalance)}</span>
        </div>
        <div style={{ ...styles.stat, ...styles.statRight }}>
          <span style={styles.statLabel}>Utilised</span>
          <span style={styles.statValue}>{formatCurrencyCompact(funds.utilisedAmount)}</span>
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
  main: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  label: {
    fontSize: 'var(--font-caption)',
    color: 'var(--color-text-muted)',
  },
  value: {
    fontSize: 'var(--font-title1)',
    fontWeight: 700,
    color: 'var(--color-text)',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '-0.5px',
  },
  divider: {
    borderTop: '1px solid var(--color-border)',
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  statRight: {
    alignItems: 'flex-end',
  },
  statLabel: {
    fontSize: 'var(--font-caption)',
    color: 'var(--color-text-muted)',
  },
  statValue: {
    fontSize: 'var(--font-body)',
    fontWeight: 600,
    color: 'var(--color-text)',
    fontVariantNumeric: 'tabular-nums',
  },
}

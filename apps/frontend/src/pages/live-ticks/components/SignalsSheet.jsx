import { useEffect, useState } from 'react'
import BottomSheet from '../../../components/BottomSheet'
import Badge from '../../../components/Badge'
import { db, ref, onValue } from '../../../utils/firebase'

export default function SignalsSheet({ isOpen, onClose, symbol }) {
  const [signals, setSignals] = useState(null)

  useEffect(() => {
    if (!isOpen || !symbol) return
    const unsub = onValue(ref(db, `signals/${symbol}`), (snap) => setSignals(snap.val()))
    return () => unsub()
  }, [isOpen, symbol])

  const strategies = signals ? Object.entries(signals) : []

  return (
    <BottomSheet title="Signals" isOpen={isOpen} onClose={onClose}>
      {strategies.length === 0 ? (
        <div style={styles.empty}>No signals yet</div>
      ) : (
        strategies.map(([strategyKey, dates]) => (
          <div key={strategyKey}>
            <div style={styles.sectionHeader}>
              <Badge label={strategyKey.replace(/_/g, ' ')} color="var(--color-primary)" />
            </div>
            {Object.entries(dates)
              .sort((a, b) => b[0].localeCompare(a[0]))
              .map(([date, data]) => (
                <div key={date} style={styles.row}>
                  <span style={styles.date}>{date}</span>
                  <span style={styles.confidence}>{(data.confidence * 100).toFixed(1)}%</span>
                  <Badge label={data.signal} color={data.signal === 'BUY' ? 'var(--color-success)' : 'var(--color-danger)'} />
                </div>
              ))}
          </div>
        ))
      )}
    </BottomSheet>
  )
}

const styles = {
  sectionHeader: {
    padding: '14px var(--space-xl) 8px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-md)',
    padding: '12px var(--space-xl)',
    borderBottom: '1px solid var(--color-border)',
  },
  date: {
    flex: 1,
    fontSize: 'var(--font-body)',
    color: 'var(--color-text)',
  },
  confidence: {
    fontSize: 'var(--font-footnote)',
    color: 'var(--color-text-muted)',
    fontVariantNumeric: 'tabular-nums',
  },
  empty: {
    padding: 'var(--space-xl)',
    textAlign: 'center',
    color: 'var(--color-text-muted)',
    fontSize: 'var(--font-body)',
  },
}

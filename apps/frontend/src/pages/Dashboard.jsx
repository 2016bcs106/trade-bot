import { useState, useEffect } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../utils/firebase'

const styles = {
  container: { padding: '1rem', paddingBottom: '5rem' },
  header: { fontSize: '1.3rem', fontWeight: '700', marginBottom: '1rem', color: 'var(--pm-text)' },
  card: {
    background: 'var(--pm-card-bg)',
    borderRadius: '12px',
    border: '1px solid var(--pm-border)',
    padding: '1rem',
    marginBottom: '0.75rem',
  },
  cardTitle: { fontSize: '0.85rem', fontWeight: '600', color: 'var(--pm-text)', marginBottom: '0.5rem' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.3rem 0' },
  label: { fontSize: '0.75rem', color: 'var(--pm-text-muted)' },
  value: { fontSize: '0.75rem', fontWeight: '600', color: 'var(--pm-text)' },
  badge: {
    padding: '0.15rem 0.5rem',
    borderRadius: '4px',
    fontSize: '0.65rem',
    fontWeight: '600',
  },
  badgeGreen: { background: 'rgba(34, 197, 94, 0.15)', color: '#22c55e' },
  badgeRed: { background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' },
  badgeBlue: { background: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6' },
  empty: { textAlign: 'center', padding: '2rem', color: 'var(--pm-text-muted)', fontSize: '0.85rem' },
  predRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.6rem 0',
    borderBottom: '1px solid var(--pm-border)',
  },
  symbol: { fontWeight: '600', fontSize: '0.8rem', color: 'var(--pm-text)' },
  predValues: { textAlign: 'right', fontSize: '0.7rem', color: 'var(--pm-text-muted)' },
}

export default function Dashboard() {
  const [predictions, setPredictions] = useState({})
  const [models, setModels] = useState({})

  useEffect(() => {
    const predRef = ref(db, 'predictions')
    const unsubPred = onValue(predRef, (snap) => {
      setPredictions(snap.val() || {})
    })

    const modelsRef = ref(db, 'models')
    const unsubModels = onValue(modelsRef, (snap) => {
      setModels(snap.val() || {})
    })

    return () => { unsubPred(); unsubModels() }
  }, [])

  const today = new Date().toISOString().split('T')[0]

  // Get today's predictions across all symbols
  const todayPredictions = Object.entries(predictions).flatMap(([symbol, dates]) => {
    const todayData = dates?.[today]
    if (!todayData) return []
    return [{ symbol, ...todayData }]
  })

  // Get model info per symbol
  const modelSummaries = Object.entries(models).map(([symbol, versions]) => {
    const versionEntries = Object.entries(versions || {})
    const production = versionEntries.find(([, v]) => v?.state === 'production')
    return {
      symbol,
      productionVersion: production ? production[0] : null,
      totalVersions: versionEntries.length,
    }
  })

  return (
    <div style={styles.container}>

      {/* Summary Card */}
      <div style={styles.card}>
        <div style={styles.cardTitle}>Overview</div>
        <div style={styles.row}>
          <span style={styles.label}>Today's Predictions</span>
          <span style={styles.value}>{todayPredictions.length}</span>
        </div>
        <div style={styles.row}>
          <span style={styles.label}>Active Models</span>
          <span style={styles.value}>{modelSummaries.filter(m => m.productionVersion).length}</span>
        </div>
        <div style={styles.row}>
          <span style={styles.label}>Total Stocks Tracked</span>
          <span style={styles.value}>{Object.keys(predictions).length}</span>
        </div>
      </div>

      {/* Today's Predictions */}
      <div style={styles.card}>
        <div style={styles.cardTitle}>Today's Predictions ({today})</div>
        {todayPredictions.length === 0 ? (
          <div style={styles.empty}>No predictions generated today</div>
        ) : (
          todayPredictions.map((pred) => (
            <div key={pred.symbol} style={styles.predRow}>
              <div>
                <div style={styles.symbol}>{pred.symbol}</div>
                <div style={{ fontSize: '0.65rem', color: 'var(--pm-text-muted)' }}>
                  {pred.modelVersion} • {pred.modelType}
                </div>
              </div>
              <div style={styles.predValues}>
                <div>H: ₹{pred.predictedHigh?.toFixed(2)}</div>
                <div>L: ₹{pred.predictedLow?.toFixed(2)}</div>
                {pred.evaluated && (
                  <span style={{ ...styles.badge, ...(pred.rangeContainment ? styles.badgeGreen : styles.badgeRed) }}>
                    {pred.rangeContainment ? '✓ In Range' : '✗ Out'}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Active Models */}
      <div style={styles.card}>
        <div style={styles.cardTitle}>Active Models</div>
        {modelSummaries.length === 0 ? (
          <div style={styles.empty}>No models trained yet</div>
        ) : (
          modelSummaries.map((m) => (
            <div key={m.symbol} style={styles.row}>
              <span style={styles.symbol}>{m.symbol}</span>
              <span style={{ ...styles.badge, ...styles.badgeBlue }}>
                {m.productionVersion || 'No production'}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

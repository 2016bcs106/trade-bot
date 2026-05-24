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
  symbolHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.5rem',
  },
  symbolName: { fontSize: '1rem', fontWeight: '700', color: 'var(--pm-text)' },
  versionBadge: { fontSize: '0.7rem', fontWeight: '600', color: 'var(--pm-text-muted)' },
  modelType: { fontSize: '0.75rem', color: 'var(--pm-text-muted)', marginBottom: '0.5rem' },
  badge: { padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.6rem', fontWeight: '600' },
  badgeProduction: { background: 'rgba(34, 197, 94, 0.15)', color: '#22c55e' },
  badgeShadow: { background: 'rgba(234, 179, 8, 0.15)', color: '#eab308' },
  badgeRetired: { background: 'rgba(107, 114, 128, 0.15)', color: '#6b7280' },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '0.4rem',
    marginTop: '0.6rem',
  },
  metric: { textAlign: 'center' },
  metricValue: { fontSize: '0.8rem', fontWeight: '700', color: 'var(--pm-text)' },
  metricLabel: { fontSize: '0.55rem', color: 'var(--pm-text-muted)' },
  trainInfo: { fontSize: '0.65rem', color: 'var(--pm-text-muted)', marginTop: '0.5rem' },
  empty: { textAlign: 'center', padding: '2rem', color: 'var(--pm-text-muted)', fontSize: '0.85rem' },
}

function getBadgeStyle(state) {
  switch (state) {
    case 'production': return styles.badgeProduction
    case 'shadow': return styles.badgeShadow
    default: return styles.badgeRetired
  }
}

export default function Models() {
  const [models, setModels] = useState({})

  useEffect(() => {
    const modelsRef = ref(db, 'models')
    const unsub = onValue(modelsRef, (snap) => {
      setModels(snap.val() || {})
    })
    return () => unsub()
  }, [])

  // Get the production model per symbol (fallback to latest if no production)
  const latestModels = Object.entries(models).map(([symbol, versions]) => {
    const entries = Object.entries(versions || {})
    if (entries.length === 0) return null

    // Find the production model
    const production = entries.find(([, meta]) => meta.state === 'production')
    if (production) {
      const [version, meta] = production
      return { symbol, version, meta, totalVersions: entries.length }
    }

    // Fallback: latest version
    const sorted = entries.sort(([a], [b]) => {
      const numA = parseInt(a.replace('v', ''))
      const numB = parseInt(b.replace('v', ''))
      return numB - numA
    })
    const [version, meta] = sorted[0]
    return { symbol, version, meta, totalVersions: entries.length }
  }).filter(Boolean)

  return (
    <div style={styles.container}>

      {latestModels.length === 0 ? (
        <div style={styles.empty}>No models trained yet. Use the CLI to train models.</div>
      ) : (
        latestModels.map(({ symbol, version, meta, totalVersions }) => (
          <div key={symbol} style={styles.card}>
            <div style={styles.symbolHeader}>
              <span style={styles.symbolName}>{symbol}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={styles.versionBadge}>{version}</span>
                <span style={{ ...styles.badge, ...getBadgeStyle(meta.state) }}>
                  {meta.state}
                </span>
              </div>
            </div>

            <div style={styles.modelType}>
              {meta.modelType} • trained {meta.createdAt || 'unknown'} • {totalVersions} version{totalVersions !== 1 ? 's' : ''} total
            </div>

            {meta.metrics && (
              <div style={styles.metricsGrid}>
                <div style={styles.metric}>
                  <div style={styles.metricValue}>₹{meta.metrics.mae?.toFixed(1)}</div>
                  <div style={styles.metricLabel}>MAE</div>
                </div>
                <div style={styles.metric}>
                  <div style={styles.metricValue}>{meta.metrics.mape?.toFixed(2)}%</div>
                  <div style={styles.metricLabel}>MAPE</div>
                </div>
                <div style={styles.metric}>
                  <div style={styles.metricValue}>{meta.metrics.directionalAccuracy?.toFixed(0)}%</div>
                  <div style={styles.metricLabel}>Direction</div>
                </div>
                <div style={styles.metric}>
                  <div style={styles.metricValue}>{meta.metrics.r2?.toFixed(3)}</div>
                  <div style={styles.metricLabel}>R²</div>
                </div>
              </div>
            )}

            {meta.training && (
              <div style={styles.trainInfo}>
                {meta.training.sampleCount} samples • {meta.training.featureCount} features • {meta.training.dataStartDate} → {meta.training.dataEndDate}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )
}

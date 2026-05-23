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
    marginBottom: '0.75rem',
  },
  symbolName: { fontSize: '0.95rem', fontWeight: '700', color: 'var(--pm-text)' },
  versionRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.5rem 0',
    borderBottom: '1px solid var(--pm-border)',
  },
  versionName: { fontSize: '0.8rem', fontWeight: '600', color: 'var(--pm-text)' },
  versionMeta: { fontSize: '0.65rem', color: 'var(--pm-text-muted)' },
  badge: { padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.6rem', fontWeight: '600' },
  badgeProduction: { background: 'rgba(34, 197, 94, 0.15)', color: '#22c55e' },
  badgeShadow: { background: 'rgba(234, 179, 8, 0.15)', color: '#eab308' },
  badgeRetired: { background: 'rgba(107, 114, 128, 0.15)', color: '#6b7280' },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '0.4rem',
    marginTop: '0.4rem',
  },
  metric: { textAlign: 'center' },
  metricValue: { fontSize: '0.75rem', fontWeight: '700', color: 'var(--pm-text)' },
  metricLabel: { fontSize: '0.55rem', color: 'var(--pm-text-muted)' },
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

  const symbols = Object.keys(models)

  return (
    <div style={styles.container}>

      {symbols.length === 0 ? (
        <div style={styles.empty}>No models trained yet. Use the CLI to train models.</div>
      ) : (
        symbols.map((symbol) => {
          const versions = Object.entries(models[symbol] || {})
            .sort(([a], [b]) => {
              const numA = parseInt(a.replace('v', ''))
              const numB = parseInt(b.replace('v', ''))
              return numB - numA
            })

          return (
            <div key={symbol} style={styles.card}>
              <div style={styles.symbolHeader}>
                <span style={styles.symbolName}>{symbol}</span>
                <span style={{ fontSize: '0.7rem', color: 'var(--pm-text-muted)' }}>
                  {versions.length} version{versions.length !== 1 ? 's' : ''}
                </span>
              </div>

              {versions.map(([version, meta]) => (
                <div key={version}>
                  <div style={styles.versionRow}>
                    <div>
                      <div style={styles.versionName}>{version}</div>
                      <div style={styles.versionMeta}>
                        {meta.modelType} • {meta.createdAt || 'unknown'}
                      </div>
                    </div>
                    <span style={{ ...styles.badge, ...getBadgeStyle(meta.state) }}>
                      {meta.state}
                    </span>
                  </div>

                  {meta.metrics && (
                    <div style={styles.metricsGrid}>
                      <div style={styles.metric}>
                        <div style={styles.metricValue}>{meta.metrics.mae?.toFixed(2)}</div>
                        <div style={styles.metricLabel}>MAE</div>
                      </div>
                      <div style={styles.metric}>
                        <div style={styles.metricValue}>{meta.metrics.mape?.toFixed(1)}%</div>
                        <div style={styles.metricLabel}>MAPE</div>
                      </div>
                      <div style={styles.metric}>
                        <div style={styles.metricValue}>{meta.metrics.directionalAccuracy?.toFixed(0)}%</div>
                        <div style={styles.metricLabel}>Dir. Acc</div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        })
      )}
    </div>
  )
}

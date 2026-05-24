import { useState, useEffect } from 'react'
import { ref, onValue, set, remove } from 'firebase/database'
import { db } from '../utils/firebase'

const styles = {
  container: { padding: '1rem', paddingBottom: '5rem' },
  card: {
    background: 'var(--pm-card-bg)',
    borderRadius: '12px',
    border: '1px solid var(--pm-border)',
    padding: '1rem',
    marginBottom: '0.75rem',
    cursor: 'pointer',
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
  // Modal styles
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.6)', zIndex: 1000,
    display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
  },
  modal: {
    background: 'var(--pm-card-bg)', borderRadius: '16px 16px 0 0',
    width: '100%', maxWidth: '480px', maxHeight: '70vh',
    overflow: 'auto', padding: '1.25rem', paddingBottom: '5rem',
  },
  modalHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: '1rem',
  },
  modalTitle: { fontSize: '1.1rem', fontWeight: '700', color: 'var(--pm-text)' },
  closeBtn: {
    background: 'none', border: 'none', color: 'var(--pm-text-muted)',
    fontSize: '1.5rem', cursor: 'pointer', padding: '0.25rem',
  },
  versionItem: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '0.75rem 0', borderBottom: '1px solid var(--pm-border)',
  },
  versionInfo: { flex: 1 },
  versionName: { fontSize: '0.85rem', fontWeight: '600', color: 'var(--pm-text)' },
  versionMeta: { fontSize: '0.65rem', color: 'var(--pm-text-muted)' },
  versionActions: { display: 'flex', gap: '0.4rem' },
  promoteBtn: {
    padding: '0.3rem 0.6rem', borderRadius: '6px', border: 'none',
    background: 'rgba(34, 197, 94, 0.15)', color: '#22c55e',
    fontSize: '0.6rem', fontWeight: '600', cursor: 'pointer',
  },
  deleteBtn: {
    padding: '0.3rem 0.6rem', borderRadius: '6px', border: 'none',
    background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444',
    fontSize: '0.6rem', fontWeight: '600', cursor: 'pointer',
  },
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
  const [selectedSymbol, setSelectedSymbol] = useState(null)

  useEffect(() => {
    const modelsRef = ref(db, 'models')
    const unsub = onValue(modelsRef, (snap) => {
      setModels(snap.val() || {})
    })
    return () => unsub()
  }, [])

  // Get the production model per symbol (fallback to latest)
  const latestModels = Object.entries(models).map(([symbol, versions]) => {
    const entries = Object.entries(versions || {})
    if (entries.length === 0) return null

    const production = entries.find(([, meta]) => meta.state === 'production')
    if (production) {
      const [version, meta] = production
      return { symbol, version, meta, totalVersions: entries.length }
    }

    const sorted = entries.sort(([a], [b]) =>
      parseInt(b.replace('v', '')) - parseInt(a.replace('v', ''))
    )
    const [version, meta] = sorted[0]
    return { symbol, version, meta, totalVersions: entries.length }
  }).filter(Boolean)

  // Promote a version to production
  const handlePromote = async (symbol, version) => {
    const versions = models[symbol] || {}
    // Retire all other versions, set this one to production
    for (const [v, meta] of Object.entries(versions)) {
      if (v === version) {
        await set(ref(db, `models/${symbol}/${v}/state`), 'production')
        await set(ref(db, `models/${symbol}/${v}/promotedAt`), new Date().toISOString())
      } else if (meta.state === 'production') {
        await set(ref(db, `models/${symbol}/${v}/state`), 'retired')
        await set(ref(db, `models/${symbol}/${v}/retiredAt`), new Date().toISOString())
      }
    }
    // Update stock's currentProductionVersion
    await set(ref(db, `stocks/${symbol}/currentProductionVersion`), version)
  }

  // Delete a version
  const handleDelete = async (symbol, version) => {
    const meta = models[symbol]?.[version]
    if (meta?.state === 'production') {
      alert('Cannot delete the production model. Promote another version first.')
      return
    }
    if (!confirm(`Delete ${symbol} ${version}?`)) return
    await remove(ref(db, `models/${symbol}/${version}`))
  }

  // Modal content
  const selectedVersions = selectedSymbol
    ? Object.entries(models[selectedSymbol] || {}).sort(([a], [b]) =>
        parseInt(b.replace('v', '')) - parseInt(a.replace('v', ''))
      )
    : []

  return (
    <div style={styles.container}>
      {latestModels.length === 0 ? (
        <div style={styles.empty}>No models trained yet. Use the CLI to train models.</div>
      ) : (
        latestModels.map(({ symbol, version, meta, totalVersions }) => (
          <div key={symbol} style={styles.card} onClick={() => setSelectedSymbol(symbol)}>
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
              {meta.modelType} • {meta.createdAt || 'unknown'} • {totalVersions} version{totalVersions !== 1 ? 's' : ''}
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
          </div>
        ))
      )}

      {/* Version Detail Modal */}
      {selectedSymbol && (
        <div style={styles.overlay} onClick={() => setSelectedSymbol(null)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <span style={styles.modalTitle}>{selectedSymbol} — All Versions</span>
              <button style={styles.closeBtn} onClick={() => setSelectedSymbol(null)}>×</button>
            </div>

            {selectedVersions.map(([version, meta]) => (
              <div key={version} style={styles.versionItem}>
                <div style={styles.versionInfo}>
                  <div style={styles.versionName}>
                    {version}{' '}
                    <span style={{ ...styles.badge, ...getBadgeStyle(meta.state) }}>
                      {meta.state}
                    </span>
                  </div>
                  <div style={styles.versionMeta}>
                    {meta.modelType} • MAE: {meta.metrics?.mae?.toFixed(2) ?? '?'} • Dir: {meta.metrics?.directionalAccuracy?.toFixed(0) ?? '?'}%
                  </div>
                  <div style={styles.versionMeta}>
                    {meta.createdAt || 'unknown'}
                  </div>
                </div>
                <div style={styles.versionActions}>
                  {meta.state !== 'production' && (
                    <button
                      style={styles.promoteBtn}
                      onClick={() => handlePromote(selectedSymbol, version)}
                    >
                      Promote
                    </button>
                  )}
                  {meta.state !== 'production' && (
                    <button
                      style={styles.deleteBtn}
                      onClick={() => handleDelete(selectedSymbol, version)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

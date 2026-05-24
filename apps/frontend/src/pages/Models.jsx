import { useState, useEffect } from 'react'
import { ref, onValue, set, remove, push } from 'firebase/database'
import { db } from '../utils/firebase'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faRotate, faPlus, faSpinner, faTrash, faArrowUp, faXmark } from '@fortawesome/free-solid-svg-icons'

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
  badgeUntrained: { background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' },
  badgeProcessing: { background: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6' },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '0.4rem',
    marginTop: '0.6rem',
  },
  metric: { textAlign: 'center' },
  metricValue: { fontSize: '0.8rem', fontWeight: '700', color: 'var(--pm-text)' },
  metricLabel: { fontSize: '0.55rem', color: 'var(--pm-text-muted)' },
  empty: { textAlign: 'center', padding: '2rem', color: 'var(--pm-text-muted)', fontSize: '0.85rem' },
  // Modal styles
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.6)', zIndex: 1000,
    display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
  },
  modal: {
    background: 'var(--pm-card-bg)', borderRadius: '16px 16px 0 0',
    width: '100%', maxWidth: '480px', maxHeight: '75vh',
    display: 'flex', flexDirection: 'column',
  },
  modalHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '1.25rem 1.25rem 0.75rem', borderBottom: '1px solid var(--pm-border)',
    flexShrink: 0,
  },
  modalBody: {
    overflow: 'auto', padding: '0 1.25rem', paddingBottom: '5rem', flex: 1,
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
  trainBtn: {
    padding: '0.4rem 0.75rem', borderRadius: '6px', border: 'none',
    background: '#3b82f6', color: '#fff',
    fontSize: '0.65rem', fontWeight: '600', cursor: 'pointer',
  },
  trainBtnDisabled: {
    padding: '0.4rem 0.75rem', borderRadius: '6px', border: 'none',
    background: '#555', color: '#aaa',
    fontSize: '0.65rem', fontWeight: '600', cursor: 'not-allowed',
    opacity: 0.6,
  },
}

function getBadgeStyle(state) {
  switch (state) {
    case 'production': return styles.badgeProduction
    case 'shadow': return styles.badgeShadow
    case 'untrained': return styles.badgeUntrained
    case 'processing': return styles.badgeProcessing
    default: return styles.badgeRetired
  }
}

export default function Models() {
  const [models, setModels] = useState({})
  const [stocks, setStocks] = useState({})
  const [pendingTrainings, setPendingTrainings] = useState({})
  const [selectedSymbol, setSelectedSymbol] = useState(null)
  const [training, setTraining] = useState(false) // track submission state

  useEffect(() => {
    const modelsRef = ref(db, 'models')
    const stocksRef = ref(db, 'stocks')
    const pendingRef = ref(db, 'pending_trainings')
    const unsub1 = onValue(modelsRef, (snap) => setModels(snap.val() || {}))
    const unsub2 = onValue(stocksRef, (snap) => setStocks(snap.val() || {}))
    const unsub3 = onValue(pendingRef, (snap) => setPendingTrainings(snap.val() || {}))
    return () => { unsub1(); unsub2(); unsub3() }
  }, [])

  // Build unified stock list: trained + untrained
  const enabledSymbols = Object.entries(stocks)
    .filter(([, s]) => s.enabled)
    .map(([symbol]) => symbol)
    .sort()

  // Check if a symbol has a pending/processing training
  const getTrainingStatus = (symbol) => {
    for (const [, entry] of Object.entries(pendingTrainings)) {
      if (entry.symbol === symbol && (entry.status === 'pending' || entry.status === 'processing')) {
        return entry.status
      }
    }
    return null
  }

  // Build rows combining trained and untrained
  const rows = enabledSymbols.map((symbol) => {
    const versions = models[symbol] ? Object.entries(models[symbol]) : []
    const trainingStatus = getTrainingStatus(symbol)

    if (versions.length === 0) {
      return { symbol, trained: false, trainingStatus }
    }

    // Find production version
    const production = versions.find(([, meta]) => meta.state === 'production')
    if (production) {
      const [version, meta] = production
      return { symbol, trained: true, version, meta, totalVersions: versions.length, trainingStatus }
    }

    // Fallback to latest
    const sorted = versions.sort(([a], [b]) =>
      parseInt(b.replace('v', '')) - parseInt(a.replace('v', ''))
    )
    const [version, meta] = sorted[0]
    return { symbol, trained: true, version, meta, totalVersions: versions.length, trainingStatus }
  })

  // Queue training for a stock
  const queueTraining = async (symbol, e) => {
    e.stopPropagation()
    setTraining(true)
    try {
      const pendingRef = ref(db, 'pending_trainings')
      const newRef = push(pendingRef)
      await set(newRef, {
        symbol,
        modelType: 'auto',
        lookbackDays: 90,
        status: 'pending',
        createdAt: new Date().toISOString(),
      })
    } catch (err) {
      console.error(err)
      alert('Failed to queue training')
    }
    setTraining(false)
  }

  // Promote a version to production
  const handlePromote = async (symbol, version) => {
    const versions = models[symbol] || {}
    for (const [v, meta] of Object.entries(versions)) {
      if (v === version) {
        await set(ref(db, `models/${symbol}/${v}/state`), 'production')
        await set(ref(db, `models/${symbol}/${v}/promotedAt`), new Date().toISOString())
      } else if (meta.state === 'production') {
        await set(ref(db, `models/${symbol}/${v}/state`), 'retired')
        await set(ref(db, `models/${symbol}/${v}/retiredAt`), new Date().toISOString())
      }
    }
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
      {rows.length === 0 ? (
        <div style={styles.empty}>No enabled stocks. Add stocks first.</div>
      ) : (
        rows.map((row) => (
          <div key={row.symbol} style={styles.card} onClick={() => row.trained && setSelectedSymbol(row.symbol)}>
            <div style={styles.symbolHeader}>
              <span style={styles.symbolName}>{row.symbol}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {row.trained && (
                  <>
                    <span style={styles.versionBadge}>{row.version}</span>
                    <span style={{ ...styles.badge, ...getBadgeStyle(row.meta.state) }}>
                      {row.meta.state}
                    </span>
                  </>
                )}
                {row.trainingStatus ? (
                  <span style={{ ...styles.badge, ...styles.badgeProcessing }}>
                    <FontAwesomeIcon icon={faSpinner} spin style={{ marginRight: '0.2rem' }} />
                    {row.trainingStatus === 'processing' ? 'Training' : 'Queued'}
                  </span>
                ) : (
                  <button
                    style={{ ...styles.badge, background: 'rgba(59,130,246,0.15)', color: '#3b82f6', border: 'none', cursor: 'pointer' }}
                    onClick={(e) => queueTraining(row.symbol, e)}
                    disabled={training}
                  >
                    <FontAwesomeIcon icon={row.trained ? faRotate : faPlus} style={{ marginRight: '0.2rem' }} />
                    {row.trained ? 'Retrain' : 'Train'}
                  </button>
                )}
              </div>
            </div>

            {row.trained ? (
              <>
                <div style={styles.modelType}>
                  {row.meta.modelType} • {row.meta.createdAt || 'unknown'} • {row.totalVersions} version{row.totalVersions !== 1 ? 's' : ''}
                </div>

                {row.meta.metrics && (
                  <div style={styles.metricsGrid}>
                    <div style={styles.metric}>
                      <div style={styles.metricValue}>₹{row.meta.metrics.mae?.toFixed(1)}</div>
                      <div style={styles.metricLabel}>MAE</div>
                    </div>
                    <div style={styles.metric}>
                      <div style={styles.metricValue}>{row.meta.metrics.mape?.toFixed(2)}%</div>
                      <div style={styles.metricLabel}>MAPE</div>
                    </div>
                    <div style={styles.metric}>
                      <div style={styles.metricValue}>{row.meta.metrics.directionalAccuracy?.toFixed(0)}%</div>
                      <div style={styles.metricLabel}>Direction</div>
                    </div>
                    <div style={styles.metric}>
                      <div style={styles.metricValue}>{row.meta.metrics.r2?.toFixed(3)}</div>
                      <div style={styles.metricLabel}>R²</div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: '0.7rem', color: 'var(--pm-text-muted)', marginTop: '0.1rem' }}>
                No model trained yet
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
              <span style={styles.modalTitle}>{selectedSymbol}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {getTrainingStatus(selectedSymbol) ? (
                  <span style={{ ...styles.badge, ...styles.badgeProcessing }}>
                    <FontAwesomeIcon icon={faSpinner} spin style={{ marginRight: '0.2rem' }} />
                    {getTrainingStatus(selectedSymbol) === 'processing' ? 'Training' : 'Queued'}
                  </span>
                ) : (
                  <button
                    style={{ ...styles.badge, background: 'rgba(59,130,246,0.15)', color: '#3b82f6', border: 'none', cursor: 'pointer' }}
                    disabled={training}
                    onClick={(e) => queueTraining(selectedSymbol, e)}
                  >
                    <FontAwesomeIcon icon={faPlus} style={{ marginRight: '0.2rem' }} />
                    Train
                  </button>
                )}
                <button style={styles.closeBtn} onClick={() => setSelectedSymbol(null)}>
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              </div>
            </div>

            <div style={styles.modalBody}>

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
                        <FontAwesomeIcon icon={faArrowUp} style={{ marginRight: '0.2rem' }} />
                        Promote
                      </button>
                    )}
                    {meta.state !== 'production' && (
                      <button
                        style={styles.deleteBtn}
                        onClick={() => handleDelete(selectedSymbol, version)}
                      >
                        <FontAwesomeIcon icon={faTrash} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

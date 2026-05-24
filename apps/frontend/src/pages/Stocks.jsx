import { useState, useEffect } from 'react'
import { db, ref, set, remove, onValue } from '../utils/firebase'
import { layout, text, colors } from '../utils/styles'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faChartBar,
  faTrash,
  faToggleOn,
  faToggleOff,
  faPlus,
  faSync,
  faBrain,
  faInfoCircle,
  faTrophy,
  faClock,
  faLayerGroup,
} from '@fortawesome/free-solid-svg-icons'

const styles = {
  container: { paddingBottom: '7.5rem' },
  card: {
    background: colors.white,
    borderBottom: `1px solid ${colors.light}`,
    padding: '0.75rem 1rem',
  },
  cardTop: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
  },
  symbolCol: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minWidth: 0,
  },
  symbol: { fontSize: '0.9rem', fontWeight: '700', color: colors.dark },
  name: { fontSize: '0.7rem', color: colors.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  statusBadge: {
    fontSize: '0.6rem', fontWeight: '700', letterSpacing: '0.04em',
    padding: '0.15rem 0.4rem', borderRadius: '4px', textAlign: 'center', flexShrink: 0,
  },
  modelRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginTop: '0.4rem',
    paddingTop: '0.4rem',
    borderTop: `1px solid ${colors.light}`,
    fontSize: '0.7rem',
    color: colors.muted,
  },
  modelChip: {
    fontSize: '0.6rem',
    fontWeight: '600',
    padding: '0.1rem 0.35rem',
    borderRadius: '4px',
    background: 'rgba(59, 130, 246, 0.1)',
    color: '#3b82f6',
  },
  iconBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    padding: '0.3rem', fontSize: '0.9rem', color: 'var(--pm-text-muted)',
  },
  // Modals
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
    padding: '1.25rem 1.25rem 0.75rem', borderBottom: '1px solid var(--pm-border)', flexShrink: 0,
  },
  modalBody: { overflow: 'auto', padding: '0 1.25rem', paddingBottom: '5rem', flex: 1 },
  modalTitle: { fontSize: '1.1rem', fontWeight: '700', color: 'var(--pm-text)' },
  modalClose: { background: 'none', border: 'none', fontSize: '1.5rem', color: 'var(--pm-text-muted)', cursor: 'pointer', padding: '0.25rem' },
  detailRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.3rem 0' },
  detailLabel: { fontSize: '0.75rem', color: colors.muted, fontWeight: '500' },
  detailValue: { fontSize: '0.75rem', color: colors.dark, fontWeight: '600' },
  sectionHeader: { fontSize: '0.6rem', fontWeight: '700', textTransform: 'uppercase', color: colors.muted, letterSpacing: '0.05em', marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: `1px solid ${colors.light}` },
  actionRow: { display: 'flex', gap: '0.75rem', marginTop: '0.25rem', paddingTop: '0.6rem', borderTop: `1px solid ${colors.light}`, flexWrap: 'wrap' },
  actionBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.3rem 0' },
  // Model version card inside models modal
  versionCard: {
    padding: '0.6rem 0',
    borderBottom: `1px solid ${colors.light}`,
  },
  versionHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  versionTag: {
    fontSize: '0.7rem', fontWeight: '700', color: colors.dark,
  },
  prodBadge: {
    fontSize: '0.55rem', fontWeight: '700', padding: '0.1rem 0.3rem',
    borderRadius: '3px', background: 'rgba(34, 197, 94, 0.12)', color: '#22c55e',
  },
  metricRow: {
    display: 'flex', gap: '0.75rem', marginTop: '0.2rem', flexWrap: 'wrap',
  },
  metric: { fontSize: '0.65rem', color: colors.muted },
  metricVal: { fontWeight: '600', color: colors.dark },
  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem 1rem', gap: '0.75rem' },
  addBar: {
    position: 'fixed', bottom: '4.5rem', left: 0, right: 0, padding: '0.6rem 1rem',
    background: 'var(--pm-bg)', borderTop: '1px solid var(--pm-border)',
    display: 'flex', gap: '0.5rem', alignItems: 'center', zIndex: 90,
  },
  addInput: {
    flex: 1, padding: '0.6rem 0.8rem', borderRadius: '8px',
    border: '1px solid var(--pm-border)', background: 'var(--pm-card-bg)',
    color: 'var(--pm-text)', fontSize: '0.85rem', outline: 'none', textTransform: 'uppercase',
  },
  addBtn: {
    padding: '0.6rem 1rem', borderRadius: '8px', border: 'none',
    background: 'var(--pm-primary)', color: '#fff', fontWeight: '600',
    fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem',
  },
}

function getStatusStyle(stock) {
  if (stock.status === 'pending_sync') return { background: 'rgba(245, 158, 11, 0.12)', color: '#f59e0b', text: 'PENDING' }
  if (stock.status === 'sync_failed') return { background: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', text: 'FAILED' }
  if (stock.enabled) return { background: 'rgba(34, 197, 94, 0.12)', color: '#22c55e', text: 'ACTIVE' }
  return { background: 'rgba(148, 163, 184, 0.12)', color: '#94a3b8', text: 'OFF' }
}

function DetailRow({ label, value }) {
  if (value === undefined || value === null || value === '') return null
  return (
    <div style={styles.detailRow}>
      <span style={styles.detailLabel}>{label}</span>
      <span style={styles.detailValue}>{value}</span>
    </div>
  )
}

function ToggleRow({ label, enabled, onToggle }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0' }}>
      <span style={{ fontSize: '0.75rem', fontWeight: '500', color: colors.dark }}>{label}</span>
      <button onClick={onToggle} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.3rem', color: enabled ? '#22c55e' : '#94a3b8', padding: 0 }}>
        <FontAwesomeIcon icon={enabled ? faToggleOn : faToggleOff} />
      </button>
    </div>
  )
}

// ─── Stock Detail Modal ────────────────────────────────────────────────
function StockDetailModal({ stock, onClose, onToggleEnabled, onToggleAutoOptimize, onRemove }) {
  const isPending = stock.status === 'pending_sync'
  const isFailed = stock.status === 'sync_failed'

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <span style={styles.modalTitle}>{stock.symbol} — Details</span>
          <button style={styles.modalClose} onClick={onClose}>×</button>
        </div>
        <div style={styles.modalBody}>
          {isPending ? (
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Status</span>
              <span style={{ ...styles.detailValue, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <FontAwesomeIcon icon={faSync} /> Pending Sync
              </span>
            </div>
          ) : isFailed ? (
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Status</span>
              <span style={{ ...styles.detailValue, color: '#ef4444' }}>Sync Failed — symbol not found on NSE</span>
            </div>
          ) : (
            <>
              <div style={styles.sectionHeader}>Stock Info</div>
              <DetailRow label="Name" value={stock.name} />
              <DetailRow label="Exchange" value={stock.exchange} />
              <DetailRow label="Security ID" value={stock.securityId} />
              <DetailRow label="PML ID" value={stock.pmlId} />
              <DetailRow label="ISIN" value={stock.isin} />
              <DetailRow label="Industry" value={stock.industryName} />
              <DetailRow label="Market Cap (₹ Cr)" value={stock.mcap ? stock.mcap.toLocaleString('en-IN') : undefined} />
              <DetailRow label="Tick Size" value={stock.tickSize} />
              <DetailRow label="Lot Size" value={stock.lotSize} />
              <DetailRow label="Added" value={stock.addedAt ? new Date(stock.addedAt).toLocaleDateString('en-IN') : undefined} />
              <DetailRow label="Updated" value={stock.updatedAt ? new Date(stock.updatedAt).toLocaleDateString('en-IN') : undefined} />

              <div style={styles.sectionHeader}>Configuration</div>
              <ToggleRow label="Predictions Enabled" enabled={!!stock.enabled} onToggle={onToggleEnabled} />
              <ToggleRow label="Auto Model Selection" enabled={!!stock.autoOptimize} onToggle={onToggleAutoOptimize} />
              <DetailRow label="Active Model" value={stock.currentProductionVersion || '—'} />
            </>
          )}
          <div style={{ ...styles.actionRow, justifyContent: 'flex-end' }}>
            <button style={{ ...styles.actionBtn, color: '#ef4444' }} onClick={onRemove}>
              <FontAwesomeIcon icon={faTrash} /> Remove Stock
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Models Modal ──────────────────────────────────────────────────────
function ModelsModal({ symbol, models, productionVersion, onClose }) {
  const versions = models
    ? Object.entries(models)
        .map(([v, meta]) => ({ version: v, ...meta }))
        .sort((a, b) => (b.trainedAt || '').localeCompare(a.trainedAt || ''))
    : []

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <span style={styles.modalTitle}>{symbol} — Models</span>
          <button style={styles.modalClose} onClick={onClose}>×</button>
        </div>
        <div style={styles.modalBody}>
          {versions.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: colors.muted, fontSize: '0.8rem' }}>
              No models trained yet
            </div>
          ) : (
            versions.map((m) => (
              <div key={m.version} style={styles.versionCard}>
                <div style={styles.versionHeader}>
                  <span style={styles.versionTag}>{m.version}</span>
                  {m.version === productionVersion && (
                    <span style={styles.prodBadge}>
                      <FontAwesomeIcon icon={faTrophy} /> PROD
                    </span>
                  )}
                </div>
                <div style={styles.metricRow}>
                  {m.modelType && <span style={styles.metric}>Type: <span style={styles.metricVal}>{m.modelType}</span></span>}
                  {m.metrics?.mae != null && <span style={styles.metric}>MAE: <span style={styles.metricVal}>{m.metrics.mae.toFixed(2)}</span></span>}
                  {m.metrics?.rmse != null && <span style={styles.metric}>RMSE: <span style={styles.metricVal}>{m.metrics.rmse.toFixed(2)}</span></span>}
                  {m.metrics?.r2 != null && <span style={styles.metric}>R²: <span style={styles.metricVal}>{m.metrics.r2.toFixed(3)}</span></span>}
                </div>
                <div style={styles.metricRow}>
                  {m.trainedAt && <span style={styles.metric}><FontAwesomeIcon icon={faClock} /> {new Date(m.trainedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}</span>}
                  {m.trainingDays && <span style={styles.metric}>{m.trainingDays}d data</span>}
                  {m.featureCount && <span style={styles.metric}>{m.featureCount} features</span>}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────
export default function Stocks() {
  const [stocks, setStocks] = useState(undefined)
  const [models, setModels] = useState({})
  const [symbolInput, setSymbolInput] = useState('')
  const [detailSymbol, setDetailSymbol] = useState(null)
  const [modelsSymbol, setModelsSymbol] = useState(null)

  useEffect(() => {
    const stocksRef = ref(db, 'stocks')
    const modelsRef = ref(db, 'models')
    const unsub1 = onValue(stocksRef, (snap) => setStocks(snap.val() || {}))
    const unsub2 = onValue(modelsRef, (snap) => setModels(snap.val() || {}))
    return () => { unsub1(); unsub2() }
  }, [])

  const stockList = stocks
    ? Object.entries(stocks)
        .map(([key, val]) => ({ ...val, _key: key, symbol: key }))
        .sort((a, b) => (b.updatedAt || b.addedAt || 0) - (a.updatedAt || a.addedAt || 0))
    : []

  const existingSymbols = stocks ? Object.keys(stocks) : []
  const selectedStock = detailSymbol && stocks ? { ...stocks[detailSymbol], _key: detailSymbol, symbol: detailSymbol } : null

  const handleAdd = async () => {
    const symbol = symbolInput.trim().toUpperCase()
    if (!symbol || existingSymbols.includes(symbol)) { setSymbolInput(''); return }
    await set(ref(db, `stocks/${symbol}`), { symbol, status: 'pending_sync', addedAt: Date.now() })
    setSymbolInput('')
  }

  const handleToggleEnabled = async (stock) => {
    await set(ref(db, `stocks/${stock._key}/enabled`), !stock.enabled)
    await set(ref(db, `stocks/${stock._key}/updatedAt`), Date.now())
  }

  const handleToggleAutoOptimize = async (stock) => {
    await set(ref(db, `stocks/${stock._key}/autoOptimize`), !stock.autoOptimize)
    await set(ref(db, `stocks/${stock._key}/updatedAt`), Date.now())
  }

  const handleRemove = async (stock) => {
    setDetailSymbol(null)
    await Promise.all([
      remove(ref(db, `stocks/${stock._key}`)),
      remove(ref(db, `models/${stock._key}`)),
      remove(ref(db, `predictions/${stock._key}`)),
    ])
  }

  // Get production model metadata for a stock
  const getProductionModel = (symbol) => {
    const stock = stocks?.[symbol]
    const prodVersion = stock?.currentProductionVersion
    if (!prodVersion || !models[symbol]?.[prodVersion]) return null
    return { version: prodVersion, ...models[symbol][prodVersion] }
  }

  if (stocks === undefined) {
    return <div style={layout.page}><div style={styles.emptyState}><span style={text.muted}>Loading...</span></div></div>
  }

  return (
    <div style={layout.page}>
      <div style={styles.container}>
        {stockList.length === 0 ? (
          <div style={styles.emptyState}>
            <FontAwesomeIcon icon={faChartBar} style={{ fontSize: '2rem', color: 'var(--pm-text-muted)' }} />
            <span style={text.muted}>No stocks tracked yet</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--pm-text-muted)' }}>Type a symbol below to add</span>
          </div>
        ) : (
          stockList.map((stock) => {
            const status = getStatusStyle(stock)
            const prodModel = getProductionModel(stock.symbol)
            return (
              <div key={stock._key} style={styles.card}>
                {/* Top row: symbol + status + action icons */}
                <div style={styles.cardTop}>
                  <div style={styles.symbolCol}>
                    <span style={styles.symbol}>{stock.symbol}</span>
                    <span style={styles.name}>{stock.name || '—'}</span>
                  </div>
                  <span style={{ ...styles.statusBadge, background: status.background, color: status.color }}>
                    {status.text}
                  </span>
                  <button style={styles.iconBtn} title="View models" onClick={() => setModelsSymbol(stock.symbol)}>
                    <FontAwesomeIcon icon={faLayerGroup} />
                  </button>
                  <button style={styles.iconBtn} title="Stock details" onClick={() => setDetailSymbol(stock.symbol)}>
                    <FontAwesomeIcon icon={faInfoCircle} />
                  </button>
                </div>

                {/* Production model summary row */}
                {prodModel && (
                  <div style={styles.modelRow}>
                    <FontAwesomeIcon icon={faBrain} style={{ color: '#3b82f6', fontSize: '0.7rem' }} />
                    <span style={styles.modelChip}>{prodModel.modelType || 'model'}</span>
                    <span>v{prodModel.version}</span>
                    {prodModel.metrics?.mae != null && <span>MAE: <b>{prodModel.metrics.mae.toFixed(2)}</b></span>}
                    {prodModel.trainedAt && (
                      <span style={{ marginLeft: 'auto', fontSize: '0.6rem', color: colors.muted }}>
                        {new Date(prodModel.trainedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </span>
                    )}
                  </div>
                )}
                {!prodModel && stock.enabled && !stock.status && (
                  <div style={styles.modelRow}>
                    <FontAwesomeIcon icon={faBrain} style={{ color: colors.muted, fontSize: '0.7rem' }} />
                    <span style={{ fontStyle: 'italic' }}>No model trained yet</span>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Add stock bar */}
      <div style={styles.addBar}>
        <input
          style={styles.addInput}
          placeholder="e.g. RELIANCE"
          value={symbolInput}
          onChange={(e) => setSymbolInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <button style={styles.addBtn} onClick={handleAdd} disabled={!symbolInput.trim()}>
          <FontAwesomeIcon icon={faPlus} /> Add
        </button>
      </div>

      {/* Stock detail modal */}
      {selectedStock && (
        <StockDetailModal
          stock={selectedStock}
          onClose={() => setDetailSymbol(null)}
          onToggleEnabled={() => handleToggleEnabled(selectedStock)}
          onToggleAutoOptimize={() => handleToggleAutoOptimize(selectedStock)}
          onRemove={() => handleRemove(selectedStock)}
        />
      )}

      {/* Models modal */}
      {modelsSymbol && (
        <ModelsModal
          symbol={modelsSymbol}
          models={models[modelsSymbol] || {}}
          productionVersion={stocks[modelsSymbol]?.currentProductionVersion}
          onClose={() => setModelsSymbol(null)}
        />
      )}
    </div>
  )
}

import { useState, useEffect } from 'react'
import { db, ref, set, remove, onValue } from '../utils/firebase'
import { layout, text, colors } from '../utils/styles'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faChartBar,
  faTrash,
  faToggleOn,
  faToggleOff,
  faCog,
  faPlus,
  faSync,
  faTimes,
} from '@fortawesome/free-solid-svg-icons'

const styles = {
  container: {
    paddingBottom: '7.5rem',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    padding: '0.75rem 1rem',
    background: colors.white,
    borderBottom: `1px solid ${colors.light}`,
    gap: '0.75rem',
    cursor: 'pointer',
  },
  symbolCol: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minWidth: 0,
  },
  symbol: {
    fontSize: '0.9rem',
    fontWeight: '700',
    color: colors.dark,
  },
  name: {
    fontSize: '0.7rem',
    color: colors.muted,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  statusBadge: {
    fontSize: '0.6rem',
    fontWeight: '700',
    letterSpacing: '0.04em',
    padding: '0.15rem 0.4rem',
    borderRadius: '4px',
    textAlign: 'center',
    flexShrink: 0,
  },
  // Modal
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 200,
    padding: '1rem',
  },
  modal: {
    background: colors.white,
    borderRadius: '12px',
    width: '100%',
    maxWidth: '340px',
    padding: '1.25rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: '1rem',
    fontWeight: '700',
    color: colors.dark,
  },
  modalClose: {
    background: 'none',
    border: 'none',
    fontSize: '1.1rem',
    color: colors.muted,
    cursor: 'pointer',
    padding: '0.2rem',
  },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.3rem 0',
  },
  detailLabel: {
    fontSize: '0.75rem',
    color: colors.muted,
    fontWeight: '500',
  },
  detailValue: {
    fontSize: '0.75rem',
    color: colors.dark,
    fontWeight: '600',
  },
  actionRow: {
    display: 'flex',
    gap: '0.75rem',
    marginTop: '0.25rem',
    paddingTop: '0.6rem',
    borderTop: `1px solid ${colors.light}`,
    flexWrap: 'wrap',
  },
  actionBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.75rem',
    fontWeight: '600',
    display: 'flex',
    alignItems: 'center',
    gap: '0.3rem',
    padding: '0.3rem 0',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4rem 1rem',
    gap: '0.75rem',
  },
  addBar: {
    position: 'fixed',
    bottom: '4.5rem',
    left: 0,
    right: 0,
    padding: '0.6rem 1rem',
    background: 'var(--pm-bg)',
    borderTop: '1px solid var(--pm-border)',
    display: 'flex',
    gap: '0.5rem',
    alignItems: 'center',
    zIndex: 90,
  },
  addInput: {
    flex: 1,
    padding: '0.6rem 0.8rem',
    borderRadius: '8px',
    border: '1px solid var(--pm-border)',
    background: 'var(--pm-card-bg)',
    color: 'var(--pm-text)',
    fontSize: '0.85rem',
    outline: 'none',
    textTransform: 'uppercase',
  },
  addBtn: {
    padding: '0.6rem 1rem',
    borderRadius: '8px',
    border: 'none',
    background: 'var(--pm-primary)',
    color: '#fff',
    fontWeight: '600',
    fontSize: '0.85rem',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '0.3rem',
  },
}

function getStatusStyle(stock) {
  if (stock.status === 'pending_sync') {
    return { background: 'rgba(245, 158, 11, 0.12)', color: '#f59e0b', text: 'PENDING' }
  }
  if (stock.status === 'sync_failed') {
    return { background: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', text: 'FAILED' }
  }
  if (stock.enabled) {
    return { background: 'rgba(34, 197, 94, 0.12)', color: '#22c55e', text: 'ACTIVE' }
  }
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
      <button
        onClick={onToggle}
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.3rem', color: enabled ? '#22c55e' : '#94a3b8', padding: 0 }}
      >
        <FontAwesomeIcon icon={enabled ? faToggleOn : faToggleOff} />
      </button>
    </div>
  )
}

function StockDetailModal({ stock, onClose, onToggleEnabled, onToggleAutoOptimize, onRemove }) {
  const isPending = stock.status === 'pending_sync'
  const isFailed = stock.status === 'sync_failed'

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <span style={styles.modalTitle}>{stock.symbol}</span>
          <button style={styles.modalClose} onClick={onClose}>
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

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
            <span style={{ ...styles.detailValue, color: '#ef4444' }}>
              Sync Failed — symbol not found on NSE
            </span>
          </div>
        ) : (
          <>
            {/* Stock Details Section */}
            <div style={{ fontSize: '0.6rem', fontWeight: '700', textTransform: 'uppercase', color: colors.muted, letterSpacing: '0.05em', marginTop: '0.25rem' }}>
              Stock Details
            </div>
            <DetailRow label="Name" value={stock.name} />
            <DetailRow label="Exchange" value={stock.exchange} />
            <DetailRow label="Security ID" value={stock.securityId} />
            <DetailRow label="ISIN" value={stock.isin} />
            <DetailRow label="Industry" value={stock.industryName} />
            <DetailRow label="Market Cap (₹ Cr)" value={stock.mcap ? stock.mcap.toLocaleString('en-IN') : undefined} />
            <DetailRow label="Tick Size" value={stock.tickSize} />
            <DetailRow label="Lot Size" value={stock.lotSize} />
            <DetailRow label="Added" value={stock.addedAt ? new Date(stock.addedAt).toLocaleDateString('en-IN') : undefined} />

            {/* Configuration Section */}
            <div style={{ fontSize: '0.6rem', fontWeight: '700', textTransform: 'uppercase', color: colors.muted, letterSpacing: '0.05em', marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: `1px solid ${colors.light}` }}>
              Configuration
            </div>
            <ToggleRow label="Predictions Enabled" enabled={!!stock.enabled} onToggle={onToggleEnabled} />
            <ToggleRow label="Auto Model Selection" enabled={!!stock.autoOptimize} onToggle={onToggleAutoOptimize} />
            <DetailRow label="Active Model" value={stock.currentProductionVersion || '—'} />
          </>
        )}

        <div style={{ ...styles.actionRow, justifyContent: 'flex-end' }}>
          <button
            style={{ ...styles.actionBtn, color: '#ef4444' }}
            onClick={onRemove}
          >
            <FontAwesomeIcon icon={faTrash} />
            Remove Stock
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Stocks() {
  const [stocks, setStocks] = useState(undefined)
  const [symbolInput, setSymbolInput] = useState('')
  const [selectedSymbol, setSelectedSymbol] = useState(null)

  useEffect(() => {
    const stocksRef = ref(db, 'stocks')
    const unsubscribe = onValue(stocksRef, (snapshot) => {
      setStocks(snapshot.val() || {})
    })
    return () => unsubscribe()
  }, [])

  const stockList = stocks
    ? Object.entries(stocks)
        .map(([key, val]) => ({ ...val, _key: key }))
        .sort((a, b) => (b.updatedAt || b.addedAt || 0) - (a.updatedAt || a.addedAt || 0))
    : []
  const existingSymbols = stocks ? Object.keys(stocks) : []

  // Derive selected stock from live state (not a stale snapshot)
  const selectedStock = selectedSymbol && stocks ? { ...stocks[selectedSymbol], _key: selectedSymbol, symbol: selectedSymbol } : null

  const handleAdd = async () => {
    const symbol = symbolInput.trim().toUpperCase()
    if (!symbol) return
    if (existingSymbols.includes(symbol)) {
      setSymbolInput('')
      return
    }
    await set(ref(db, `stocks/${symbol}`), {
      symbol,
      status: 'pending_sync',
      addedAt: Date.now(),
    })
    setSymbolInput('')
  }

  const handleToggleEnabled = async (stock) => {
    const key = stock._key || stock.symbol
    await set(ref(db, `stocks/${key}/enabled`), !stock.enabled)
    await set(ref(db, `stocks/${key}/updatedAt`), Date.now())
  }

  const handleToggleAutoOptimize = async (stock) => {
    const key = stock._key || stock.symbol
    await set(ref(db, `stocks/${key}/autoOptimize`), !stock.autoOptimize)
    await set(ref(db, `stocks/${key}/updatedAt`), Date.now())
  }

  const handleRemove = async (stock) => {
    const key = stock._key || stock.symbol
    setSelectedSymbol(null)
    await remove(ref(db, `stocks/${key}`))
  }

  if (stocks === undefined) {
    return (
      <div style={layout.page}>
        <div style={styles.emptyState}>
          <span style={text.muted}>Loading...</span>
        </div>
      </div>
    )
  }

  return (
    <div style={layout.page}>
      <div style={styles.container}>
        {stockList.length === 0 ? (
          <div style={styles.emptyState}>
            <FontAwesomeIcon icon={faChartBar} style={{ fontSize: '2rem', color: 'var(--pm-text-muted)' }} />
            <span style={text.muted}>No stocks tracked yet</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--pm-text-muted)' }}>
              Type a symbol below to add
            </span>
          </div>
        ) : (
          stockList.map((stock) => {
            const status = getStatusStyle(stock)
            const ts = stock.updatedAt || stock.addedAt
            const timeStr = ts ? new Date(ts).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : ''
            return (
              <div key={stock._key} style={styles.row} onClick={() => setSelectedSymbol(stock._key)}>
                <div style={styles.symbolCol}>
                  <span style={styles.symbol}>{stock.symbol}</span>
                  <span style={styles.name}>{stock.name || '—'}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.2rem' }}>
                  <span style={{ ...styles.statusBadge, background: status.background, color: status.color }}>
                    {status.text}
                  </span>
                  {timeStr && <span style={{ fontSize: '0.6rem', color: colors.muted }}>{timeStr}</span>}
                </div>
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
          <FontAwesomeIcon icon={faPlus} />
          Add
        </button>
      </div>

      {/* Stock detail modal */}
      {selectedStock && (
        <StockDetailModal
          stock={selectedStock}
          onClose={() => setSelectedSymbol(null)}
          onToggleEnabled={() => handleToggleEnabled(selectedStock)}
          onToggleAutoOptimize={() => handleToggleAutoOptimize(selectedStock)}
          onRemove={() => { handleRemove(selectedStock); setSelectedSymbol(null); }}
        />
      )}
    </div>
  )
}

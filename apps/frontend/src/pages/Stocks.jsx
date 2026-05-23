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
  faChevronDown,
  faChevronUp,
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
  chevron: {
    fontSize: '0.7rem',
    color: colors.muted,
    flexShrink: 0,
    width: '14px',
    textAlign: 'center',
  },
  details: {
    padding: '0.6rem 1rem 0.8rem',
    background: '#f8fafc',
    borderBottom: `1px solid ${colors.light}`,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: '0.7rem',
    color: colors.muted,
    fontWeight: '500',
  },
  detailValue: {
    fontSize: '0.7rem',
    color: colors.dark,
    fontWeight: '600',
  },
  actionRow: {
    display: 'flex',
    gap: '0.75rem',
    marginTop: '0.25rem',
    paddingTop: '0.4rem',
    borderTop: `1px solid ${colors.light}`,
  },
  actionBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.7rem',
    fontWeight: '600',
    display: 'flex',
    alignItems: 'center',
    gap: '0.25rem',
    padding: '0.2rem 0',
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
  if (stock.enabled) {
    return { background: 'rgba(34, 197, 94, 0.12)', color: '#22c55e', text: 'ACTIVE' }
  }
  return { background: 'rgba(148, 163, 184, 0.12)', color: '#94a3b8', text: 'OFF' }
}

function StockRow({ stock, isOpen, onToggle, onToggleEnabled, onToggleAutoOptimize, onRemove }) {
  const status = getStatusStyle(stock)
  const isPending = stock.status === 'pending_sync'

  return (
    <>
      <div style={styles.row} onClick={onToggle}>
        <div style={styles.symbolCol}>
          <span style={styles.symbol}>{stock.symbol}</span>
          <span style={styles.name}>{stock.name || '—'}</span>
        </div>
        <span style={{ ...styles.statusBadge, background: status.background, color: status.color }}>
          {status.text}
        </span>
        <span style={styles.chevron}>
          <FontAwesomeIcon icon={isOpen ? faChevronUp : faChevronDown} />
        </span>
      </div>
      {isOpen && (
        <div style={styles.details}>
          {!isPending && (
            <>
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Exchange</span>
                <span style={styles.detailValue}>{stock.exchange || '—'}</span>
              </div>
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Predictions</span>
                <span style={styles.detailValue}>{stock.enabled ? 'Enabled' : 'Disabled'}</span>
              </div>
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Optimization</span>
                <span style={styles.detailValue}>{stock.autoOptimize ? 'Auto' : 'Manual'}</span>
              </div>
              {stock.currentProductionVersion && (
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Model Version</span>
                  <span style={styles.detailValue}>{stock.currentProductionVersion}</span>
                </div>
              )}
            </>
          )}
          {isPending && (
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Status</span>
              <span style={{ ...styles.detailValue, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <FontAwesomeIcon icon={faSync} /> Pending Sync
              </span>
            </div>
          )}
          <div style={styles.actionRow}>
            {!isPending && (
              <>
                <button
                  style={{ ...styles.actionBtn, color: stock.enabled ? '#22c55e' : '#94a3b8' }}
                  onClick={(e) => { e.stopPropagation(); onToggleEnabled() }}
                >
                  <FontAwesomeIcon icon={stock.enabled ? faToggleOn : faToggleOff} />
                  {stock.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  style={{ ...styles.actionBtn, color: 'var(--pm-primary)' }}
                  onClick={(e) => { e.stopPropagation(); onToggleAutoOptimize() }}
                >
                  <FontAwesomeIcon icon={faCog} />
                  {stock.autoOptimize ? 'Set Manual' : 'Auto-Opt'}
                </button>
              </>
            )}
            <button
              style={{ ...styles.actionBtn, color: '#ef4444', marginLeft: 'auto' }}
              onClick={(e) => { e.stopPropagation(); onRemove() }}
            >
              <FontAwesomeIcon icon={faTrash} />
              Remove
            </button>
          </div>
        </div>
      )}
    </>
  )
}

export default function Stocks() {
  const [stocks, setStocks] = useState(undefined)
  const [symbolInput, setSymbolInput] = useState('')
  const [openSymbol, setOpenSymbol] = useState(null)

  useEffect(() => {
    const stocksRef = ref(db, 'stocks')
    const unsubscribe = onValue(stocksRef, (snapshot) => {
      setStocks(snapshot.val() || {})
    })
    return () => unsubscribe()
  }, [])

  const stockList = stocks ? Object.values(stocks) : []
  const existingSymbols = stocks ? Object.keys(stocks) : []

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
    await set(ref(db, `stocks/${stock.symbol}/enabled`), !stock.enabled)
    await set(ref(db, `stocks/${stock.symbol}/updatedAt`), Date.now())
  }

  const handleToggleAutoOptimize = async (stock) => {
    await set(ref(db, `stocks/${stock.symbol}/autoOptimize`), !stock.autoOptimize)
    await set(ref(db, `stocks/${stock.symbol}/updatedAt`), Date.now())
  }

  const handleRemove = async (stock) => {
    if (window.confirm(`Remove ${stock.symbol}?`)) {
      await remove(ref(db, `stocks/${stock.symbol}`))
    }
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
          stockList.map((stock) => (
            <StockRow
              key={stock.symbol}
              stock={stock}
              isOpen={openSymbol === stock.symbol}
              onToggle={() => setOpenSymbol(openSymbol === stock.symbol ? null : stock.symbol)}
              onToggleEnabled={() => handleToggleEnabled(stock)}
              onToggleAutoOptimize={() => handleToggleAutoOptimize(stock)}
              onRemove={() => handleRemove(stock)}
            />
          ))
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
    </div>
  )
}

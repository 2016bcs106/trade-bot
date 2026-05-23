import { useState, useEffect } from 'react'
import { db, ref, set, remove, onValue } from '../utils/firebase'
import { layout, text, card } from '../utils/styles'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faChartBar,
  faTrash,
  faToggleOn,
  faToggleOff,
  faCog,
  faPlus,
  faSync,
} from '@fortawesome/free-solid-svg-icons'

const styles = {
  container: {
    padding: '1rem',
    paddingBottom: '5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  // Stock card
  stockCard: {
    ...card.base,
    padding: '1rem 1.25rem',
  },
  cardTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '0.5rem',
  },
  symbolName: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.15rem',
  },
  symbol: { fontSize: '0.95rem', fontWeight: '700', color: 'var(--pm-text)' },
  name: { fontSize: '0.75rem', color: 'var(--pm-text-muted)' },
  actions: { display: 'flex', gap: '0.5rem', alignItems: 'center' },
  iconBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '0.3rem',
    borderRadius: '6px',
    fontSize: '1.1rem',
  },
  metaRow: {
    display: 'flex',
    gap: '1rem',
    flexWrap: 'wrap',
    marginTop: '0.4rem',
  },
  badge: {
    fontSize: '0.7rem',
    fontWeight: '500',
    padding: '0.2rem 0.5rem',
    borderRadius: '6px',
    background: 'rgba(59, 130, 246, 0.1)',
    color: 'var(--pm-primary)',
  },
  badgeDisabled: {
    background: 'rgba(148, 163, 184, 0.1)',
    color: 'var(--pm-text-muted)',
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
  pendingBadge: {
    fontSize: '0.7rem',
    fontWeight: '500',
    padding: '0.2rem 0.5rem',
    borderRadius: '6px',
    background: 'rgba(245, 158, 11, 0.15)',
    color: '#f59e0b',
    display: 'flex',
    alignItems: 'center',
    gap: '0.3rem',
  },
}

function StockCard({ stock, onToggleEnabled, onToggleAutoOptimize, onRemove }) {
  const isPending = stock.status === 'pending_sync'

  return (
    <div style={styles.stockCard}>
      <div style={styles.cardTop}>
        <div style={styles.symbolName}>
          <span style={styles.symbol}>{stock.symbol}</span>
          {stock.name ? (
            <span style={styles.name}>{stock.name}{stock.exchange ? ` · ${stock.exchange}` : ''}</span>
          ) : (
            <span style={styles.name}>—</span>
          )}
        </div>
        <div style={styles.actions}>
          {!isPending && (
            <button
              style={styles.iconBtn}
              onClick={onToggleEnabled}
              title={stock.enabled ? 'Disable predictions' : 'Enable predictions'}
            >
              <FontAwesomeIcon
                icon={stock.enabled ? faToggleOn : faToggleOff}
                style={{ color: stock.enabled ? '#22c55e' : '#94a3b8' }}
              />
            </button>
          )}
          <button style={styles.iconBtn} onClick={onRemove} title="Remove stock">
            <FontAwesomeIcon icon={faTrash} style={{ color: '#ef4444', fontSize: '0.85rem' }} />
          </button>
        </div>
      </div>
      <div style={styles.metaRow}>
        {isPending ? (
          <span style={styles.pendingBadge}>
            <FontAwesomeIcon icon={faSync} />
            Pending Sync
          </span>
        ) : (
          <>
            <span style={{ ...styles.badge, ...(stock.enabled ? {} : styles.badgeDisabled) }}>
              {stock.enabled ? 'Predictions ON' : 'Predictions OFF'}
            </span>
            <span style={{ ...styles.badge, ...(stock.autoOptimize ? {} : styles.badgeDisabled) }}>
              <button
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 'inherit', fontWeight: 'inherit', padding: 0 }}
                onClick={onToggleAutoOptimize}
              >
                <FontAwesomeIcon icon={faCog} style={{ marginRight: '0.25rem' }} />
                {stock.autoOptimize ? 'Auto-Optimize' : 'Manual'}
              </button>
            </span>
            {stock.currentProductionVersion && (
              <span style={styles.badge}>Model: {stock.currentProductionVersion}</span>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function Stocks() {
  const [stocks, setStocks] = useState(undefined)
  const [symbolInput, setSymbolInput] = useState('')

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
    if (window.confirm(`Remove ${stock.symbol} from tracking?`)) {
      await remove(ref(db, `stocks/${stock.symbol}`))
    }
  }

  // Loading state
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
            <StockCard
              key={stock.symbol}
              stock={stock}
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
          placeholder="Enter stock symbol (e.g. RELIANCE)"
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

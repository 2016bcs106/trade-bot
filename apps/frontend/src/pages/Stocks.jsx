import { useState, useEffect } from 'react'
import { db, ref, set, get, remove, onValue } from '../utils/firebase'
import { layout, text, card, button } from '../utils/styles'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faChartBar,
  faPlus,
  faTrash,
  faToggleOn,
  faToggleOff,
  faCog,
  faSearch,
  faTimes,
} from '@fortawesome/free-solid-svg-icons'

const styles = {
  container: {
    padding: '1rem',
    paddingBottom: '5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  searchBar: {
    display: 'flex',
    gap: '0.5rem',
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    padding: '0.7rem 1rem',
    border: '1px solid var(--pm-border)',
    borderRadius: '10px',
    fontSize: '0.85rem',
    background: 'var(--pm-card-bg)',
    color: 'var(--pm-text)',
    outline: 'none',
  },
  addButton: {
    padding: '0.7rem 1rem',
    background: 'var(--pm-primary)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '10px',
    fontSize: '0.85rem',
    fontWeight: '600',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
  },
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
  symbol: {
    fontSize: '0.95rem',
    fontWeight: '700',
    color: 'var(--pm-text)',
  },
  name: {
    fontSize: '0.75rem',
    color: 'var(--pm-text-muted)',
  },
  actions: {
    display: 'flex',
    gap: '0.5rem',
    alignItems: 'center',
  },
  iconBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '0.3rem',
    borderRadius: '6px',
    fontSize: '1.1rem',
    transition: 'background 0.2s',
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
    padding: '3rem 1rem',
    gap: '0.75rem',
  },
  modal: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
    padding: '1rem',
  },
  modalContent: {
    ...card.base,
    padding: '1.5rem',
    width: '100%',
    maxWidth: '400px',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  modalTitle: {
    fontSize: '1.1rem',
    fontWeight: '600',
    color: 'var(--pm-text)',
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.3rem',
  },
  inputLabel: {
    fontSize: '0.75rem',
    fontWeight: '500',
    color: 'var(--pm-text-muted)',
  },
  input: {
    padding: '0.6rem 0.8rem',
    border: '1px solid var(--pm-border)',
    borderRadius: '8px',
    fontSize: '0.85rem',
    background: 'var(--pm-card-bg)',
    color: 'var(--pm-text)',
    outline: 'none',
  },
  selectRow: {
    display: 'flex',
    gap: '0.5rem',
  },
  select: {
    padding: '0.6rem 0.8rem',
    border: '1px solid var(--pm-border)',
    borderRadius: '8px',
    fontSize: '0.85rem',
    background: 'var(--pm-card-bg)',
    color: 'var(--pm-text)',
    outline: 'none',
  },
  modalActions: {
    display: 'flex',
    gap: '0.5rem',
    justifyContent: 'flex-end',
  },
}

function AddStockModal({ onClose, onAdd, existingSymbols }) {
  const [symbol, setSymbol] = useState('')
  const [name, setName] = useState('')
  const [securityId, setSecurityId] = useState('')
  const [exchange, setExchange] = useState('NSE')
  const [error, setError] = useState('')

  const handleAdd = () => {
    const sym = symbol.trim().toUpperCase()
    if (!sym) return setError('Symbol is required')
    if (!name.trim()) return setError('Name is required')
    if (!securityId.trim()) return setError('Security ID is required')
    if (existingSymbols.includes(sym)) return setError('Stock already tracked')
    setError('')
    onAdd({ symbol: sym, name: name.trim(), securityId: securityId.trim(), exchange })
  }

  return (
    <div style={styles.modal} onClick={onClose}>
      <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <span style={styles.modalTitle}>Add Stock</span>

        <div style={styles.inputGroup}>
          <span style={styles.inputLabel}>Symbol</span>
          <input
            style={styles.input}
            placeholder="e.g. RELIANCE"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            autoFocus
          />
        </div>

        <div style={styles.inputGroup}>
          <span style={styles.inputLabel}>Name</span>
          <input
            style={styles.input}
            placeholder="e.g. Reliance Industries Ltd"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div style={styles.selectRow}>
          <div style={{ ...styles.inputGroup, flex: 1 }}>
            <span style={styles.inputLabel}>Security ID</span>
            <input
              style={styles.input}
              placeholder="Paytm Money ID"
              value={securityId}
              onChange={(e) => setSecurityId(e.target.value)}
            />
          </div>
          <div style={styles.inputGroup}>
            <span style={styles.inputLabel}>Exchange</span>
            <select
              style={styles.select}
              value={exchange}
              onChange={(e) => setExchange(e.target.value)}
            >
              <option value="NSE">NSE</option>
              <option value="BSE">BSE</option>
            </select>
          </div>
        </div>

        {error && <span style={{ fontSize: '0.75rem', color: '#ef4444' }}>{error}</span>}

        <div style={styles.modalActions}>
          <button style={button.outline} onClick={onClose}>Cancel</button>
          <button style={{ ...styles.addButton, padding: '0.6rem 1.2rem' }} onClick={handleAdd}>
            <FontAwesomeIcon icon={faPlus} /> Add
          </button>
        </div>
      </div>
    </div>
  )
}

function StockCard({ stock, onToggleEnabled, onToggleAutoOptimize, onRemove }) {
  return (
    <div style={styles.stockCard}>
      <div style={styles.cardTop}>
        <div style={styles.symbolName}>
          <span style={styles.symbol}>{stock.symbol}</span>
          <span style={styles.name}>{stock.name} · {stock.exchange}</span>
        </div>
        <div style={styles.actions}>
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
          <button
            style={styles.iconBtn}
            onClick={onRemove}
            title="Remove stock"
          >
            <FontAwesomeIcon icon={faTrash} style={{ color: '#ef4444', fontSize: '0.85rem' }} />
          </button>
        </div>
      </div>
      <div style={styles.metaRow}>
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
      </div>
    </div>
  )
}

export default function Stocks() {
  const [stocks, setStocks] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    const stocksRef = ref(db, 'stocks')
    const unsubscribe = onValue(stocksRef, (snapshot) => {
      setStocks(snapshot.val())
    })
    return () => unsubscribe()
  }, [])

  const stockList = stocks
    ? Object.values(stocks).filter((s) =>
        s.symbol.toLowerCase().includes(filter.toLowerCase()) ||
        s.name.toLowerCase().includes(filter.toLowerCase())
      )
    : []

  const existingSymbols = stocks ? Object.keys(stocks) : []

  const handleAdd = async ({ symbol, name, securityId, exchange }) => {
    const now = Date.now()
    const config = {
      symbol,
      name,
      securityId,
      exchange,
      enabled: true,
      autoOptimize: true,
      currentProductionVersion: null,
      addedAt: now,
      updatedAt: now,
    }
    await set(ref(db, `stocks/${symbol}`), config)
    setShowAddModal(false)
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

  return (
    <div style={layout.page}>

      <div style={styles.container}>
        <div style={styles.searchBar}>
          <div style={{ position: 'relative', flex: 1 }}>
            <FontAwesomeIcon
              icon={faSearch}
              style={{ position: 'absolute', left: '0.8rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--pm-text-muted)', fontSize: '0.8rem' }}
            />
            <input
              style={{ ...styles.searchInput, paddingLeft: '2.2rem' }}
              placeholder="Filter stocks..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {filter && (
              <button
                style={{ position: 'absolute', right: '0.6rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--pm-text-muted)' }}
                onClick={() => setFilter('')}
              >
                <FontAwesomeIcon icon={faTimes} />
              </button>
            )}
          </div>
          <button style={styles.addButton} onClick={() => setShowAddModal(true)}>
            <FontAwesomeIcon icon={faPlus} /> Add
          </button>
        </div>

        {stockList.length === 0 ? (
          <div style={styles.emptyState}>
            <FontAwesomeIcon icon={faChartBar} style={{ fontSize: '2rem', color: 'var(--pm-text-muted)' }} />
            <span style={text.muted}>
              {stocks === null ? 'Loading...' : filter ? 'No matching stocks' : 'No stocks tracked yet'}
            </span>
            {!filter && stocks !== null && (
              <span style={{ fontSize: '0.75rem', color: 'var(--pm-text-muted)' }}>
                Tap "Add" to start tracking a stock
              </span>
            )}
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

      {showAddModal && (
        <AddStockModal
          onClose={() => setShowAddModal(false)}
          onAdd={handleAdd}
          existingSymbols={existingSymbols}
        />
      )}
    </div>
  )
}

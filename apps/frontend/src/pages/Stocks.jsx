import { useState, useEffect } from 'react'
import { db, ref, set, remove, onValue } from '../utils/firebase'
import { layout, text, card, button } from '../utils/styles'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faChartBar,
  faTrash,
  faToggleOn,
  faToggleOff,
  faCog,
  faSearch,
  faTimes,
  faPlus,
  faSpinner,
} from '@fortawesome/free-solid-svg-icons'

const styles = {
  container: {
    padding: '1rem',
    paddingBottom: '7rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  // Bottom search bar
  searchBarWrapper: {
    position: 'fixed',
    bottom: '3.5rem',
    left: 0,
    right: 0,
    padding: '0.6rem 1rem',
    background: 'var(--pm-bg)',
    borderTop: '1px solid var(--pm-border)',
    zIndex: 999,
  },
  searchInput: {
    width: '100%',
    padding: '0.7rem 1rem 0.7rem 2.2rem',
    border: '1px solid var(--pm-border)',
    borderRadius: '10px',
    fontSize: '0.85rem',
    background: 'var(--pm-card-bg)',
    color: 'var(--pm-text)',
    outline: 'none',
  },
  searchIcon: {
    position: 'absolute',
    left: '1.8rem',
    top: '50%',
    transform: 'translateY(-50%)',
    color: 'var(--pm-text-muted)',
    fontSize: '0.8rem',
  },
  clearBtn: {
    position: 'absolute',
    right: '1.8rem',
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--pm-text-muted)',
  },
  // Search results overlay
  searchResults: {
    position: 'fixed',
    bottom: '6.5rem',
    left: '1rem',
    right: '1rem',
    maxHeight: '40vh',
    overflowY: 'auto',
    background: 'var(--pm-card-bg)',
    borderRadius: '12px',
    border: '1px solid var(--pm-border)',
    boxShadow: '0 -4px 12px rgba(0,0,0,0.1)',
    zIndex: 1001,
  },
  searchResultItem: {
    padding: '0.7rem 1rem',
    borderBottom: '1px solid var(--pm-border)',
    cursor: 'pointer',
  },
  resultSymbol: { fontSize: '0.85rem', fontWeight: '600', color: 'var(--pm-text)' },
  resultName: { fontSize: '0.7rem', color: 'var(--pm-text-muted)' },
  // Stock detail modal
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
    gap: '0.75rem',
  },
  modalTitle: { fontSize: '1.1rem', fontWeight: '700', color: 'var(--pm-text)' },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '0.3rem 0',
  },
  detailLabel: { fontSize: '0.75rem', color: 'var(--pm-text-muted)' },
  detailValue: { fontSize: '0.75rem', fontWeight: '600', color: 'var(--pm-text)' },
  modalActions: {
    display: 'flex',
    gap: '0.5rem',
    justifyContent: 'flex-end',
    marginTop: '0.5rem',
  },
  addButton: {
    padding: '0.6rem 1.2rem',
    background: 'var(--pm-primary)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '10px',
    fontSize: '0.85rem',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
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
    padding: '3rem 1rem',
    gap: '0.75rem',
  },
}

/**
 * Placeholder for Paytm Money stock search API.
 * TODO: Replace with actual API call when endpoint is provided.
 */
async function searchStocksAPI(query) {
  // Simulated delay + mock results for now
  await new Promise((r) => setTimeout(r, 300))

  // Return mock results based on query
  const mockStocks = [
    { symbol: 'RELIANCE', name: 'Reliance Industries Ltd', exchange: 'NSE', securityId: '2885' },
    { symbol: 'TCS', name: 'Tata Consultancy Services Ltd', exchange: 'NSE', securityId: '11536' },
    { symbol: 'HDFCBANK', name: 'HDFC Bank Ltd', exchange: 'NSE', securityId: '1333' },
    { symbol: 'INFY', name: 'Infosys Ltd', exchange: 'NSE', securityId: '1594' },
    { symbol: 'ICICIBANK', name: 'ICICI Bank Ltd', exchange: 'NSE', securityId: '4963' },
    { symbol: 'HINDUNILVR', name: 'Hindustan Unilever Ltd', exchange: 'NSE', securityId: '1394' },
    { symbol: 'SBIN', name: 'State Bank of India', exchange: 'NSE', securityId: '3045' },
    { symbol: 'BHARTIARTL', name: 'Bharti Airtel Ltd', exchange: 'NSE', securityId: '10604' },
    { symbol: 'ITC', name: 'ITC Ltd', exchange: 'NSE', securityId: '1660' },
    { symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank Ltd', exchange: 'NSE', securityId: '1922' },
  ]

  if (!query.trim()) return []
  const q = query.toLowerCase()
  return mockStocks.filter(
    (s) => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
  )
}

function StockDetailModal({ stock, onClose, onAdd, alreadyTracked }) {
  return (
    <div style={styles.modal} onClick={onClose}>
      <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <span style={styles.modalTitle}>{stock.symbol}</span>

        <div style={styles.detailRow}>
          <span style={styles.detailLabel}>Name</span>
          <span style={styles.detailValue}>{stock.name}</span>
        </div>
        <div style={styles.detailRow}>
          <span style={styles.detailLabel}>Exchange</span>
          <span style={styles.detailValue}>{stock.exchange}</span>
        </div>
        <div style={styles.detailRow}>
          <span style={styles.detailLabel}>Security ID</span>
          <span style={styles.detailValue}>{stock.securityId}</span>
        </div>

        {alreadyTracked ? (
          <div style={{ fontSize: '0.75rem', color: '#eab308', textAlign: 'center', padding: '0.5rem' }}>
            Already tracked
          </div>
        ) : (
          <div style={styles.modalActions}>
            <button style={button.outline} onClick={onClose}>Cancel</button>
            <button style={styles.addButton} onClick={() => onAdd(stock)}>
              <FontAwesomeIcon icon={faPlus} /> Add to Watchlist
            </button>
          </div>
        )}
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
          <button style={styles.iconBtn} onClick={onRemove} title="Remove stock">
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
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [selectedStock, setSelectedStock] = useState(null)

  useEffect(() => {
    const stocksRef = ref(db, 'stocks')
    const unsubscribe = onValue(stocksRef, (snapshot) => {
      setStocks(snapshot.val())
    })
    return () => unsubscribe()
  }, [])

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      return
    }
    const timer = setTimeout(async () => {
      setSearching(true)
      const results = await searchStocksAPI(searchQuery)
      setSearchResults(results)
      setSearching(false)
    }, 400)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const existingSymbols = stocks ? Object.keys(stocks) : []
  const stockList = stocks ? Object.values(stocks) : []

  const handleAdd = async (stock) => {
    const now = Date.now()
    const config = {
      symbol: stock.symbol,
      name: stock.name,
      securityId: stock.securityId,
      exchange: stock.exchange,
      enabled: true,
      autoOptimize: true,
      currentProductionVersion: null,
      addedAt: now,
      updatedAt: now,
    }
    await set(ref(db, `stocks/${stock.symbol}`), config)
    setSelectedStock(null)
    setSearchQuery('')
    setSearchResults([])
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
        {stockList.length === 0 ? (
          <div style={styles.emptyState}>
            <FontAwesomeIcon icon={faChartBar} style={{ fontSize: '2rem', color: 'var(--pm-text-muted)' }} />
            <span style={text.muted}>
              {stocks === null ? 'Loading...' : 'No stocks tracked yet'}
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--pm-text-muted)' }}>
              Search below to add stocks
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

      {/* Search results popup */}
      {searchResults.length > 0 && (
        <div style={styles.searchResults}>
          {searchResults.map((result) => (
            <div
              key={result.symbol}
              style={styles.searchResultItem}
              onClick={() => {
                setSelectedStock(result)
                setSearchResults([])
              }}
            >
              <div style={styles.resultSymbol}>{result.symbol}</div>
              <div style={styles.resultName}>{result.name} · {result.exchange}</div>
            </div>
          ))}
        </div>
      )}

      {/* Bottom search bar */}
      <div style={styles.searchBarWrapper}>
        <div style={{ position: 'relative' }}>
          <FontAwesomeIcon
            icon={searching ? faSpinner : faSearch}
            style={styles.searchIcon}
            spin={searching}
          />
          <input
            style={styles.searchInput}
            placeholder="Search stocks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              style={styles.clearBtn}
              onClick={() => { setSearchQuery(''); setSearchResults([]) }}
            >
              <FontAwesomeIcon icon={faTimes} />
            </button>
          )}
        </div>
      </div>

      {/* Stock detail modal */}
      {selectedStock && (
        <StockDetailModal
          stock={selectedStock}
          onClose={() => setSelectedStock(null)}
          onAdd={handleAdd}
          alreadyTracked={existingSymbols.includes(selectedStock.symbol)}
        />
      )}
    </div>
  )
}

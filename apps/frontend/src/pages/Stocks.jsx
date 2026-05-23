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
  const [stocks, setStocks] = useState(undefined)

  useEffect(() => {
    const stocksRef = ref(db, 'stocks')
    const unsubscribe = onValue(stocksRef, (snapshot) => {
      setStocks(snapshot.val() || {})
    })
    return () => unsubscribe()
  }, [])

  const stockList = stocks ? Object.values(stocks) : []

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
              Stocks will appear here once added via Firebase
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
    </div>
  )
}

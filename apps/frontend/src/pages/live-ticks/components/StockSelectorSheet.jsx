import { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faStar as faStarSolid } from '@fortawesome/free-solid-svg-icons'
import { faStar as faStarOutline } from '@fortawesome/free-regular-svg-icons'
import BottomSheet from '../../../components/BottomSheet'

export default function StockSelectorSheet({ isOpen, onClose, stocks, selectedInstrumentKey, getPriceInfo, onSelectStock, onToggleFavorite }) {
  const [search, setSearch] = useState('')

  const handleClose = () => {
    onClose()
    setSearch('')
  }

  const filtered = [...stocks].filter((s) => {
    if (!search) return true
    const q = search.toLowerCase()
    return s.symbol.toLowerCase().includes(q) || (s.displayName || '').toLowerCase().includes(q)
  }).sort((a, b) => {
    if (a.isFavorite && !b.isFavorite) return -1
    if (!a.isFavorite && b.isFavorite) return 1
    return a.symbol.localeCompare(b.symbol)
  })

  return (
    <BottomSheet title="Select Stock" isOpen={isOpen} onClose={handleClose}>
      <div style={styles.searchWrap}>
        <input
          style={styles.searchInput}
          type="text"
          inputMode="none"
          placeholder="Search stocks..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={(e) => { e.target.inputMode = 'text' }}
          onBlur={(e) => { e.target.inputMode = 'none' }}
        />
      </div>
      {filtered.map((stock) => {
        const info = getPriceInfo(stock.instrumentKey)
        return (
          <div
            key={stock.instrumentKey}
            style={{ ...styles.item, background: stock.instrumentKey === selectedInstrumentKey ? 'var(--color-primary-light)' : 'transparent' }}
          >
            <div style={{ flex: 1, minWidth: 0 }} onClick={() => { onSelectStock(stock); handleClose() }}>
              <div style={styles.symbol}>{stock.symbol}</div>
              <div style={styles.name}>{stock.displayName || '—'}</div>
            </div>
            {info && (
              <div style={{ textAlign: 'right' }} onClick={() => { onSelectStock(stock); handleClose() }}>
                <div style={{ ...styles.price, color: info.change >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                  {info.price.toFixed(2)}
                </div>
                <div style={{ ...styles.change, color: info.change >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                  {info.change >= 0 ? '+' : ''}{info.change.toFixed(2)}
                </div>
              </div>
            )}
            <button style={styles.star} onClick={() => onToggleFavorite(stock.symbol)}>
              <FontAwesomeIcon icon={stock.isFavorite ? faStarSolid : faStarOutline} style={{ color: stock.isFavorite ? 'var(--color-warning)' : 'var(--color-text-tertiary)' }} />
            </button>
          </div>
        )
      })}
    </BottomSheet>
  )
}

const styles = {
  searchWrap: {
    padding: '0 var(--space-xl) 12px',
    position: 'sticky',
    top: 0,
    background: 'var(--color-card)',
    zIndex: 1,
  },
  searchInput: {
    width: '100%',
    padding: '10px 14px',
    fontSize: 'var(--font-body)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    outline: 'none',
    boxSizing: 'border-box',
  },
  item: {
    width: '100%',
    padding: '14px var(--space-xl)',
    border: 'none',
    borderBottom: '1px solid var(--color-border)',
    textAlign: 'left',
    cursor: 'pointer',
    display: 'flex',
    transition: 'background 0.15s ease',
    alignItems: 'center',
    gap: 'var(--space-md)',
  },
  symbol: {
    fontSize: 'var(--font-body)',
    fontWeight: 500,
    color: 'var(--color-text)',
    textAlign: 'left',
  },
  name: {
    fontSize: 'var(--font-footnote)',
    color: 'var(--color-text-muted)',
    marginTop: '2px',
    textAlign: 'left',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  price: {
    fontSize: 'var(--font-body)',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  change: {
    fontSize: 'var(--font-caption)',
    fontWeight: 500,
    fontVariantNumeric: 'tabular-nums',
    marginTop: '1px',
  },
  star: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    flexShrink: 0,
    fontSize: '0.9rem',
    padding: 0,
  },
}

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChartBar, faSearch, faArrowDownWideShort, faArrowUp, faArrowDown, faStar as faStarSolid } from '@fortawesome/free-solid-svg-icons'
import { faStar as faStarOutline } from '@fortawesome/free-regular-svg-icons'
import Page from '../components/Page'
import PageHeader from '../components/PageHeader'
import Badge from '../components/Badge'
import EmptyState from '../components/EmptyState'
import Loader from '../components/Loader'
import BottomSheet from '../components/BottomSheet'
import DetailRow from '../components/DetailRow'
import useLongPress from '../hooks/useLongPress'
import { useApp } from '../context/AppContext'
import { isRecommended, getGroupRank } from '../utils/stock-grouping'

function getStatusBadge(stock) {
  if (stock.status === 'pending_sync') return { label: 'Syncing', color: 'var(--color-warning)' }
  if (stock.status === 'sync_failed') return { label: 'Failed', color: 'var(--color-danger)' }
  return null
}

function StockRow({ stock, bordered, info, showEstimatedProfit, onTap, onLongPress, onToggleFavorite }) {
  const handlers = useLongPress(
    () => onLongPress(stock.symbol),
    () => onTap(stock.symbol),
  )
  const badge = getStatusBadge(stock)

  return (
    <div
      style={{ ...styles.stockRow, ...(bordered ? styles.bordered : {}) }}
      {...handlers}
    >
      <div style={styles.stockInfo}>
        <span style={styles.symbol}>{stock.symbol}</span>
        <span style={styles.name}>{stock.displayName || '—'}</span>
      </div>
      {showEstimatedProfit ? (
        stock.estimatedProfitPct != null && (
          <div style={styles.priceCol}>
            <span style={{ ...styles.price, color: stock.estimatedProfitPct >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
              {stock.estimatedProfitPct >= 0 ? '+' : ''}{stock.estimatedProfitPct.toFixed(2)}%
            </span>
            <span style={styles.change}>Est. profit</span>
          </div>
        )
      ) : (
        <>
          {info && (
            <div style={styles.priceCol}>
              <span style={{ ...styles.price, color: info.change >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>{info.price.toFixed(2)}</span>
              <span style={{ ...styles.change, color: info.change >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                {info.change >= 0 ? '+' : ''}{info.change.toFixed(2)}
              </span>
            </div>
          )}
          {badge && <Badge label={badge.label} color={badge.color} />}
          <button style={styles.starBtn} onClick={(e) => { e.stopPropagation(); onToggleFavorite(stock.symbol) }}>
            <FontAwesomeIcon icon={stock.isFavorite ? faStarSolid : faStarOutline} style={{ color: stock.isFavorite ? 'var(--color-warning)' : 'var(--color-text-tertiary)' }} />
          </button>
        </>
      )}
    </div>
  )
}

const SORT_OPTIONS = [
  { key: 'relevance', label: 'Relevance' },
  { key: 'created', label: 'Created on' },
  { key: 'symbol', label: 'Symbol (A–Z)' },
  { key: 'price', label: 'Live price' },
  { key: 'change', label: '% Change today' },
]

export default function Stocks() {
  const navigate = useNavigate()
  const { status, stocks, getPriceInfo, selectStock, sortBy, setSortBy, sortAsc, setSortAsc, toggleFavorite } = useApp()
  const [searchQuery, setSearchQuery] = useState('')
  const [detailSymbol, setDetailSymbol] = useState(null)
  const [sortSheetOpen, setSortSheetOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('favorites')

  const getLivePriceInfo = (symbol) => {
    const stock = stocks.find((s) => s.symbol === symbol)
    if (!stock) return null
    return getPriceInfo(stock.instrumentKey)
  }

  const query = searchQuery.trim().toUpperCase()
  const filteredStocks = stocks
    .filter((s) => {
      if (activeTab === 'favorites') return s.isFavorite
      if (activeTab === 'recommended') return isRecommended(s)
      return true
    })
    .filter((s) => !query || s.symbol.includes(query) || (s.displayName || '').toUpperCase().includes(query))

  const compareBySort = (a, b) => {
    let cmp = 0
    if (sortBy === 'relevance') {
      cmp = (a.relevanceScore ?? 0) - (b.relevanceScore ?? 0)
    } else if (sortBy === 'created') {
      cmp = (b.addedAt || '').localeCompare(a.addedAt || '')
    } else if (sortBy === 'symbol') {
      cmp = a.symbol.localeCompare(b.symbol)
    } else if (sortBy === 'price') {
      const ap = getLivePriceInfo(a.symbol)?.price ?? 0
      const bp = getLivePriceInfo(b.symbol)?.price ?? 0
      cmp = bp - ap
    } else if (sortBy === 'change') {
      const ac = getLivePriceInfo(a.symbol)?.changePct ?? 0
      const bc = getLivePriceInfo(b.symbol)?.changePct ?? 0
      cmp = bc - ac
    }
    return sortAsc ? -cmp : cmp
  }

  const stockList = [...filteredStocks].sort((a, b) => {
    if (activeTab === 'recommended') {
      return (a.recommendedRank ?? Infinity) - (b.recommendedRank ?? Infinity)
    }
    if (activeTab === 'top') {
      const rankDiff = getGroupRank(a) - getGroupRank(b)
      if (rankDiff !== 0) return rankDiff
    }
    return compareBySort(a, b)
  })

  const selectedStock = detailSymbol
    ? stocks.find((s) => s.symbol === detailSymbol) || null
    : null


  if (stocks.length === 0 && status === 'connecting') {
    return <Page><Loader /></Page>
  }

  return (
    <Page>
      <PageHeader title="Stocks" />

      <div style={styles.tabRow}>
        <button style={{ ...styles.tab, ...(activeTab === 'favorites' ? styles.tabActive : {}) }} onClick={() => setActiveTab('favorites')}>
          Favorites <Badge label={`${stocks.filter((s) => s.isFavorite).length}`} color={activeTab === 'favorites' ? 'var(--color-primary)' : 'var(--color-text-muted)'} />
        </button>
        <button style={{ ...styles.tab, ...(activeTab === 'recommended' ? styles.tabActive : {}) }} onClick={() => setActiveTab('recommended')}>
          Recommended <Badge label={`${stocks.filter(isRecommended).length}`} color={activeTab === 'recommended' ? 'var(--color-primary)' : 'var(--color-text-muted)'} />
        </button>
        <button style={{ ...styles.tab, ...(activeTab === 'top' ? styles.tabActive : {}) }} onClick={() => setActiveTab('top')}>
          Top stocks <Badge label={`${stocks.length}`} color={activeTab === 'top' ? 'var(--color-primary)' : 'var(--color-text-muted)'} />
        </button>
      </div>

      <div style={styles.searchBar}>
        <FontAwesomeIcon icon={faSearch} style={styles.searchIcon} />
        <input
          style={styles.searchInput}
          placeholder="Search stocks..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {activeTab === 'favorites' && (
          <button style={styles.sortBtn} onClick={() => setSortSheetOpen(true)}>
            <FontAwesomeIcon icon={faArrowDownWideShort} />
          </button>
        )}
      </div>

      {stockList.length === 0 ? (
        <EmptyState
          icon={faChartBar}
          title={
            activeTab === 'favorites' ? 'No favorites yet' :
            activeTab === 'recommended' ? 'No recommended stocks yet' :
            'No stocks found'
          }
          subtitle={
            activeTab === 'favorites' ? 'Star a stock to add it here' :
            activeTab === 'recommended' ? 'Check back after the next signal run' :
            'Try a different search'
          }
        />
      ) : (
        <div style={styles.list}>
          {stockList.map((stock, i) => (
            <StockRow
              key={stock.instrumentKey}
              stock={stock}
              bordered={i < stockList.length - 1}
              info={getLivePriceInfo(stock.symbol)}
              showEstimatedProfit={activeTab === 'recommended'}
              onTap={(symbol) => navigate(`/live/${symbol}`)}
              onLongPress={(symbol) => setDetailSymbol(symbol)}
              onToggleFavorite={toggleFavorite}
            />
          ))}
        </div>
      )}

      {/* Detail sheet */}
      <BottomSheet title={selectedStock?.symbol} isOpen={!!selectedStock} onClose={() => setDetailSymbol(null)}>
        {selectedStock && (
          <div style={styles.sheetBody}>
            <DetailRow label="Live Price" value={(() => {
              const info = getLivePriceInfo(selectedStock.symbol)
              if (!info) return undefined
              const sign = info.change >= 0 ? '+' : ''
              return `${info.price.toFixed(2)} (${sign}${info.change.toFixed(2)})`
            })()} />
            <DetailRow label="Name" value={selectedStock.displayName} />
            <DetailRow label="Exchange" value={selectedStock.exchangeType} />
            <DetailRow label="ISIN" value={selectedStock.isin} />
            <DetailRow label="Industry" value={selectedStock.industryName} />
            <DetailRow label="Market Cap" value={selectedStock.mcap ? `${selectedStock.mcap.toLocaleString('en-IN')} Cr` : undefined} />
          </div>
        )}
      </BottomSheet>

      {/* Sort sheet */}
      <BottomSheet title="Sort by" isOpen={sortSheetOpen} onClose={() => setSortSheetOpen(false)}>
        <div style={styles.sortList}>
          {SORT_OPTIONS.map((opt) => {
            const isActive = sortBy === opt.key
            return (
              <button
                key={opt.key}
                style={{ ...styles.sortOption, ...(isActive ? styles.sortOptionActive : {}) }}
                onClick={() => {
                  if (isActive) {
                    setSortAsc((v) => !v)
                  } else {
                    setSortBy(opt.key)
                    setSortAsc(false)
                  }
                }}
              >
                <span>{opt.label}</span>
                {isActive && <FontAwesomeIcon icon={sortAsc ? faArrowUp : faArrowDown} style={styles.sortArrow} />}
              </button>
            )
          })}
        </div>
        <div style={styles.sortApplyRow}>
          <button style={styles.sortApplyBtn} onClick={() => setSortSheetOpen(false)}>Apply</button>
        </div>
      </BottomSheet>
    </Page>
  )
}

const styles = {
  tabRow: {
    display: 'flex',
    gap: '0',
    marginBottom: 'var(--space-md)',
  },
  tab: {
    flex: 1,
    padding: '10px',
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontSize: 'var(--font-footnote)',
    fontWeight: 500,
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
    textAlign: 'center',
  },
  tabActive: {
    color: 'var(--color-primary)',
    fontWeight: 600,
    boxShadow: 'inset 0 -2px 0 var(--color-primary)',
  },
  starBtn: {
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
  sortBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px',
    fontSize: '1rem',
    color: 'var(--color-primary)',
    flexShrink: 0,
  },
  sortList: {
    padding: 'var(--space-sm) 0',
  },
  sortOption: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    padding: '14px var(--space-xl)',
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid var(--color-border)',
    textAlign: 'left',
    fontSize: 'var(--font-body)',
    color: 'var(--color-text)',
    cursor: 'pointer',
  },
  sortOptionActive: {
    color: 'var(--color-primary)',
    fontWeight: 600,
  },
  sortArrow: {
    fontSize: '0.8rem',
  },
  sortApplyRow: {
    padding: 'var(--space-lg) var(--space-xl)',
  },
  sortApplyBtn: {
    width: '100%',
    padding: '14px',
    background: 'var(--color-primary)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--font-body)',
    fontWeight: 600,
    cursor: 'pointer',
  },
  list: {
    background: 'var(--color-card)',
    borderRadius: 'var(--radius-md)',
    overflow: 'hidden',
  },
  stockRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '14px var(--space-lg)',
    cursor: 'pointer',
    gap: 'var(--space-md)',
    minHeight: '56px',
  },
  bordered: {
    borderBottom: '1px solid var(--color-border)',
  },
  stockInfo: {
    flex: 1,
    minWidth: 0,
  },
  priceCol: {
    textAlign: 'right',
  },
  price: {
    display: 'block',
    fontSize: 'var(--font-body)',
    fontWeight: 600,
    color: 'var(--color-text)',
    fontVariantNumeric: 'tabular-nums',
  },
  change: {
    display: 'block',
    fontSize: 'var(--font-caption)',
    fontWeight: 500,
    fontVariantNumeric: 'tabular-nums',
    marginTop: '1px',
  },
  symbol: {
    display: 'block',
    fontSize: 'var(--font-body)',
    fontWeight: 500,
    color: 'var(--color-text)',
  },
  name: {
    display: 'block',
    fontSize: 'var(--font-footnote)',
    color: 'var(--color-text-muted)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    marginTop: '2px',
  },
  searchBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
    marginBottom: 'var(--space-md)',
    padding: '10px 16px',
    borderRadius: 'var(--radius-md)',
    background: 'var(--color-card)',
  },
  searchIcon: {
    fontSize: '0.9rem',
    color: 'var(--color-text-muted)',
  },
  searchInput: {
    flex: 1,
    border: 'none',
    background: 'transparent',
    color: 'var(--color-text)',
    fontSize: 'var(--font-body)',
    outline: 'none',
  },
  sheetBody: {
    padding: 'var(--space-lg) var(--space-xl)',
  },
}

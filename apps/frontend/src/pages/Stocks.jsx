import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import moment from 'moment'
import { db, ref, set, push } from '../utils/firebase'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChartBar, faPlus, faArrowDownWideShort, faArrowUp, faArrowDown } from '@fortawesome/free-solid-svg-icons'
import Page from '../components/Page'
import PageHeader from '../components/PageHeader'
import Badge from '../components/Badge'
import EmptyState from '../components/EmptyState'
import Loader from '../components/Loader'
import BottomSheet from '../components/BottomSheet'
import DetailRow from '../components/DetailRow'
import useLongPress from '../hooks/useLongPress'
import { useApp } from '../context/AppContext'

function getStatusBadge(stock) {
  if (stock.status === 'pending_sync') return { label: 'Syncing', color: 'var(--color-warning)' }
  if (stock.status === 'sync_failed') return { label: 'Failed', color: 'var(--color-danger)' }
  return null
}

function StockRow({ stock, bordered, info, onTap, onLongPress }) {
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
      {info && (
        <div style={styles.priceCol}>
          <span style={{ ...styles.price, color: info.change >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>{info.price.toFixed(2)}</span>
          <span style={{ ...styles.change, color: info.change >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
            {info.change >= 0 ? '+' : ''}{info.change.toFixed(2)}
          </span>
        </div>
      )}
      {badge && <Badge label={badge.label} color={badge.color} />}
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
  const { status, stocks, getPriceInfo, selectStock } = useApp()
  const [symbolInput, setSymbolInput] = useState('')
  const [detailSymbol, setDetailSymbol] = useState(null)
  const [sortBy, setSortBy] = useState('relevance')
  const [sortAsc, setSortAsc] = useState(false)
  const [sortSheetOpen, setSortSheetOpen] = useState(false)

  const getLivePriceInfo = (symbol) => {
    const stock = stocks.find((s) => s.symbol === symbol)
    if (!stock) return null
    return getPriceInfo(stock.instrumentKey)
  }

  const stockList = [...stocks].sort((a, b) => {
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
  })

  const selectedStock = detailSymbol
    ? stocks.find((s) => s.symbol === detailSymbol) || null
    : null

  const handleAdd = async () => {
    const symbol = symbolInput.trim().toUpperCase()
    if (!symbol || stocks.find((s) => s.symbol === symbol)) { setSymbolInput(''); return }
    const now = moment().utcOffset('+05:30').toISOString()
    await set(ref(db, `stocks/${symbol}`), {
      symbol, name: symbol, status: 'pending_sync', enabled: true, addedAt: now, updatedAt: now,
    })
    await push(ref(db, 'request_queue'), {
      type: 'stock_sync', payload: { symbol }, status: 'pending', createdAt: now,
    })
    setSymbolInput('')
  }

  const handleRemove = async (stock) => {
    setDetailSymbol(null)
    await push(ref(db, 'request_queue'), {
      type: 'stock_sync',
      payload: { symbol: stock.symbol, action: 'remove' },
      status: 'pending',
      createdAt: moment().utcOffset('+05:30').toISOString(),
    })
  }

  const handleSync = async (symbol) => {
    await push(ref(db, 'request_queue'), {
      type: 'stock_sync', payload: { symbol }, status: 'pending',
      createdAt: moment().utcOffset('+05:30').toISOString(),
    })
  }

  if (stocks.length === 0 && status === 'connecting') {
    return <Page><Loader /></Page>
  }

  return (
    <Page>
      <PageHeader title="Stocks" />

      {stockList.length > 0 && (
        <div style={styles.sortRow}>
          <button style={styles.sortBtn} onClick={() => setSortSheetOpen(true)}>
            <FontAwesomeIcon icon={faArrowDownWideShort} style={styles.sortIcon} />
            <span>{SORT_OPTIONS.find((o) => o.key === sortBy)?.label}</span>
          </button>
        </div>
      )}

      {stockList.length === 0 ? (
        <EmptyState icon={faChartBar} title="No stocks tracked" subtitle="Add a symbol below to get started" />
      ) : (
        <div style={styles.list}>
          {stockList.map((stock, i) => (
            <StockRow
              key={stock.instrumentKey}
              stock={stock}
              bordered={i < stockList.length - 1}
              info={getLivePriceInfo(stock.symbol)}
              onTap={(symbol) => navigate(`/live/${symbol}`)}
              onLongPress={(symbol) => setDetailSymbol(symbol)}
            />
          ))}
        </div>
      )}

      {/* Add stock bar */}
      <div style={styles.addBar}>
        <input
          style={styles.addInput}
          placeholder="Symbol (e.g. RELIANCE)"
          value={symbolInput}
          onChange={(e) => setSymbolInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <button style={styles.addBtn} onClick={handleAdd} disabled={!symbolInput.trim()}>
          <FontAwesomeIcon icon={faPlus} />
        </button>
      </div>

      {/* Detail sheet */}
      <BottomSheet title={selectedStock?.symbol} isOpen={!!selectedStock} onClose={() => setDetailSymbol(null)}>
        {selectedStock && (
          <div style={styles.sheetBody}>
            {selectedStock.status === 'pending_sync' ? (
              <div style={styles.statusMsg}>Syncing with exchange...</div>
            ) : selectedStock.status === 'sync_failed' ? (
              <div style={{ ...styles.statusMsg, color: 'var(--color-danger)' }}>Symbol not found on NSE</div>
            ) : (
              <>
                <DetailRow label="Live Price" value={(() => {
                  const info = getLivePriceInfo(selectedStock.symbol)
                  if (!info) return undefined
                  const sign = info.change >= 0 ? '+' : ''
                  return `${info.price.toFixed(2)} (${sign}${info.change.toFixed(2)})`
                })()} />
                <DetailRow label="Name" value={selectedStock.displayName} />
                <DetailRow label="Exchange" value={selectedStock.exchangeType} />
                <DetailRow label="Security ID" value={selectedStock.scripId} />
                <DetailRow label="ISIN" value={selectedStock.isin} />
                <DetailRow label="Industry" value={selectedStock.industryName} />
                <DetailRow label="Market Cap" value={selectedStock.mcap ? `${selectedStock.mcap.toLocaleString('en-IN')} Cr` : undefined} />
                <DetailRow label="Added" value={selectedStock.addedAt ? moment(selectedStock.addedAt).format('D MMM YYYY') : undefined} />

              </>
            )}

            <div style={styles.actions}>
              <button style={styles.actionBtn} onClick={() => handleSync(selectedStock.symbol)}>
                Re-sync Stock
              </button>
              <button style={{ ...styles.actionBtn, ...styles.actionBtnDanger }} onClick={() => handleRemove(selectedStock)}>
                Remove Stock
              </button>
            </div>
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
  sortRow: {
    padding: '0 var(--space-lg)',
    marginBottom: 'var(--space-sm)',
  },
  sortBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '8px 0',
    fontSize: 'var(--font-footnote)',
    fontWeight: 500,
    color: 'var(--color-primary)',
  },
  sortIcon: {
    fontSize: '0.9rem',
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
  addBar: {
    position: 'fixed',
    bottom: '70px',
    left: 'var(--space-lg)',
    right: 'var(--space-lg)',
    display: 'flex',
    gap: 'var(--space-sm)',
    alignItems: 'center',
    zIndex: 90,
  },
  addInput: {
    flex: 1,
    padding: '12px 16px',
    borderRadius: 'var(--radius-md)',
    border: 'none',
    background: 'var(--color-card)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-body)',
    outline: 'none',
    textTransform: 'uppercase',
    boxShadow: 'var(--shadow-md)',
  },
  addBtn: {
    width: '44px',
    height: '44px',
    borderRadius: '50%',
    border: 'none',
    background: 'var(--color-primary)',
    color: '#fff',
    fontSize: '1.1rem',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: 'var(--shadow-md)',
  },
  sheetBody: {
    padding: 'var(--space-lg) var(--space-xl)',
  },
  statusMsg: {
    fontSize: 'var(--font-body)',
    color: 'var(--color-text-muted)',
    padding: 'var(--space-xl) 0',
    textAlign: 'center',
  },
  actions: {
    marginTop: 'var(--space-2xl)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-sm)',
  },
  actionBtn: {
    width: '100%',
    padding: '14px',
    background: 'var(--color-bg)',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    fontSize: 'var(--font-body)',
    fontWeight: 500,
    color: 'var(--color-primary)',
    textAlign: 'center',
  },
  actionBtnDanger: {
    color: 'var(--color-danger)',
  },
}

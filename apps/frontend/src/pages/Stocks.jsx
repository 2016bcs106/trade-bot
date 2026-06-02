import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import moment from 'moment'
import { db, ref, set, push, onValue } from '../utils/firebase'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChartBar, faPlus } from '@fortawesome/free-solid-svg-icons'
import Page from '../components/Page'
import PageHeader from '../components/PageHeader'
import Badge from '../components/Badge'
import EmptyState from '../components/EmptyState'
import Loader from '../components/Loader'
import BottomSheet from '../components/BottomSheet'
import DetailRow from '../components/DetailRow'
import SectionHeader from '../components/SectionHeader'
import Toggle from '../components/Toggle'
import useLongPress from '../hooks/useLongPress'
import { useLiveTicks } from '../context/LiveTicksContext'

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
        <span style={styles.name}>{stock.name || '—'}</span>
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

export default function Stocks() {
  const navigate = useNavigate()
  const { stocks: liveStocks, getPriceInfo, sortOrder, reversedSort, setReversedSort, selectStock } = useLiveTicks()
  const [stocks, setStocks] = useState(undefined)
  const [symbolInput, setSymbolInput] = useState('')
  const [detailSymbol, setDetailSymbol] = useState(null)

  const getLivePriceInfo = (symbol) => {
    const liveStock = liveStocks.find((s) => s.symbol === symbol)
    if (!liveStock) return null
    return getPriceInfo(liveStock.instrumentKey)
  }

  useEffect(() => {
    const unsub = onValue(ref(db, 'stocks'), (snap) => setStocks(snap.val() || {}))
    return () => unsub()
  }, [])

  const stockList = stocks
    ? Object.entries(stocks)
        .map(([key, val]) => ({ ...val, _key: key, symbol: key }))
        .sort((a, b) => {
          if (sortOrder.length > 0) {
            const ai = sortOrder.indexOf(a.symbol)
            const bi = sortOrder.indexOf(b.symbol)
            const aIdx = ai === -1 ? Infinity : ai
            const bIdx = bi === -1 ? Infinity : bi
            return reversedSort ? bIdx - aIdx : aIdx - bIdx
          }
          return (b.updatedAt || b.addedAt || '').localeCompare(a.updatedAt || a.addedAt || '')
        })
    : []

  const selectedStock = detailSymbol && stocks?.[detailSymbol]
    ? { ...stocks[detailSymbol], _key: detailSymbol, symbol: detailSymbol }
    : null

  const handleAdd = async () => {
    const symbol = symbolInput.trim().toUpperCase()
    if (!symbol || stocks?.[symbol]) { setSymbolInput(''); return }
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
      payload: { symbol: stock._key, action: 'remove' },
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

  if (stocks === undefined) {
    return <Page><Loader /></Page>
  }

  return (
    <Page>
      <PageHeader title="Stocks" />

      {stockList.length > 0 && (
        <div style={styles.toggleRow}>
          <Toggle label="Reverse sort" enabled={reversedSort} onToggle={() => setReversedSort((r) => !r)} />
        </div>
      )}

      {stockList.length === 0 ? (
        <EmptyState icon={faChartBar} title="No stocks tracked" subtitle="Add a symbol below to get started" />
      ) : (
        <div style={styles.list}>
          {stockList.map((stock, i) => (
            <StockRow
              key={stock._key}
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
                <DetailRow label="Name" value={selectedStock.name} />
                <DetailRow label="Exchange" value={selectedStock.exchange} />
                <DetailRow label="Security ID" value={selectedStock.securityId} />
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
    </Page>
  )
}

const styles = {
  toggleRow: {
    padding: '0 var(--space-lg)',
    marginBottom: 'var(--space-sm)',
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

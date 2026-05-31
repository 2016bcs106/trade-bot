import { useState, useEffect } from 'react'
import moment from 'moment'
import { db, ref, set, push, onValue } from '../utils/firebase'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChartBar, faTrash, faPlus, faSync, faInfoCircle } from '@fortawesome/free-solid-svg-icons'
import Page from '../components/Page'
import PageHeader from '../components/PageHeader'
import Badge from '../components/Badge'
import EmptyState from '../components/EmptyState'
import BottomSheet from '../components/BottomSheet'
import DetailRow from '../components/DetailRow'
import Toggle from '../components/Toggle'
import SectionHeader from '../components/SectionHeader'

function getStatusBadge(stock) {
  if (stock.status === 'pending_sync') return { label: 'SYNCING', color: 'var(--color-warning)' }
  if (stock.status === 'sync_failed') return { label: 'FAILED', color: 'var(--color-danger)' }
  if (stock.enabled) return { label: 'ACTIVE', color: 'var(--color-success)' }
  return { label: 'OFF', color: 'var(--color-text-muted)' }
}

export default function Stocks() {
  const [stocks, setStocks] = useState(undefined)
  const [symbolInput, setSymbolInput] = useState('')
  const [detailSymbol, setDetailSymbol] = useState(null)

  useEffect(() => {
    const unsub = onValue(ref(db, 'stocks'), (snap) => setStocks(snap.val() || {}))
    return () => unsub()
  }, [])

  const stockList = stocks
    ? Object.entries(stocks)
        .map(([key, val]) => ({ ...val, _key: key, symbol: key }))
        .sort((a, b) => (b.updatedAt || b.addedAt || '').localeCompare(a.updatedAt || a.addedAt || ''))
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

  const handleToggleEnabled = async (stock) => {
    await set(ref(db, `stocks/${stock._key}/enabled`), !stock.enabled)
    await set(ref(db, `stocks/${stock._key}/updatedAt`), moment().utcOffset('+05:30').toISOString())
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
    return <Page><EmptyState title="Loading..." /></Page>
  }

  return (
    <Page>
      <PageHeader icon={faChartBar} title="Stocks" />

      {stockList.length === 0 ? (
        <EmptyState icon={faChartBar} title="No stocks tracked yet" subtitle="Type a symbol below to add" />
      ) : (
        stockList.map((stock) => {
          const badge = getStatusBadge(stock)
          return (
            <div key={stock._key} style={styles.card} onClick={() => setDetailSymbol(stock.symbol)}>
              <div style={styles.row}>
                <div style={styles.symbolCol}>
                  <span style={styles.symbol}>{stock.symbol}</span>
                  <span style={styles.name}>{stock.name || '—'}</span>
                </div>
                <Badge label={badge.label} color={badge.color} />
              </div>
            </div>
          )
        })
      )}

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
          <FontAwesomeIcon icon={faPlus} /> Add
        </button>
      </div>

      {/* Stock detail bottom sheet */}
      <BottomSheet title={`${selectedStock?.symbol} — Details`} isOpen={!!selectedStock} onClose={() => setDetailSymbol(null)}>
        {selectedStock && (
          <div style={styles.sheetBody}>
            {selectedStock.status === 'pending_sync' ? (
              <div style={styles.pendingMsg}>
                <FontAwesomeIcon icon={faSync} style={{ color: 'var(--color-warning)' }} /> Pending Sync
              </div>
            ) : selectedStock.status === 'sync_failed' ? (
              <div style={{ ...styles.pendingMsg, color: 'var(--color-danger)' }}>
                Sync Failed — symbol not found on NSE
              </div>
            ) : (
              <>
                <SectionHeader>Stock Info</SectionHeader>
                <DetailRow label="Name" value={selectedStock.name} />
                <DetailRow label="Exchange" value={selectedStock.exchange} />
                <DetailRow label="Security ID" value={selectedStock.securityId} />
                <DetailRow label="PML ID" value={selectedStock.pmlId} />
                <DetailRow label="ISIN" value={selectedStock.isin} />
                <DetailRow label="Industry" value={selectedStock.industryName} />
                <DetailRow label="Market Cap (₹ Cr)" value={selectedStock.mcap?.toLocaleString('en-IN')} />
                <DetailRow label="Added" value={selectedStock.addedAt ? moment(selectedStock.addedAt).format('DD MMM YYYY') : undefined} />
                <DetailRow label="Updated" value={selectedStock.updatedAt ? moment(selectedStock.updatedAt).format('DD MMM YYYY') : undefined} />

                <SectionHeader>Configuration</SectionHeader>
                <Toggle label="Enabled" enabled={!!selectedStock.enabled} onToggle={() => handleToggleEnabled(selectedStock)} />
              </>
            )}

            <div style={styles.actions}>
              <button style={styles.actionBtn} onClick={() => handleSync(selectedStock.symbol)}>
                <FontAwesomeIcon icon={faSync} /> Sync
              </button>
              <button style={{ ...styles.actionBtn, color: 'var(--color-danger)' }} onClick={() => handleRemove(selectedStock)}>
                <FontAwesomeIcon icon={faTrash} /> Remove
              </button>
            </div>
          </div>
        )}
      </BottomSheet>
    </Page>
  )
}

const styles = {
  card: {
    background: 'var(--color-card)',
    borderBottom: '1px solid var(--color-border)',
    padding: 'var(--space-md) var(--space-lg)',
    cursor: 'pointer',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-md)',
  },
  symbolCol: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minWidth: 0,
  },
  symbol: {
    fontSize: 'var(--font-md)',
    fontWeight: 700,
    color: 'var(--color-text)',
  },
  name: {
    fontSize: 'var(--font-sm)',
    color: 'var(--color-text-muted)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  addBar: {
    position: 'fixed',
    bottom: '4.5rem',
    left: 0,
    right: 0,
    padding: 'var(--space-md) var(--space-lg)',
    background: 'var(--color-bg)',
    borderTop: '1px solid var(--color-border)',
    display: 'flex',
    gap: 'var(--space-sm)',
    alignItems: 'center',
    zIndex: 90,
  },
  addInput: {
    flex: 1,
    padding: 'var(--space-md) var(--space-md)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--color-border)',
    background: 'var(--color-card)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-md)',
    outline: 'none',
    textTransform: 'uppercase',
  },
  addBtn: {
    padding: 'var(--space-md) var(--space-lg)',
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    background: 'var(--color-primary)',
    color: '#fff',
    fontWeight: 600,
    fontSize: 'var(--font-md)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-xs)',
  },
  sheetBody: {
    padding: 'var(--space-lg)',
  },
  pendingMsg: {
    fontSize: 'var(--font-md)',
    color: 'var(--color-text-secondary)',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
    padding: 'var(--space-lg) 0',
  },
  actions: {
    display: 'flex',
    gap: 'var(--space-lg)',
    marginTop: 'var(--space-lg)',
    paddingTop: 'var(--space-md)',
    borderTop: '1px solid var(--color-border)',
  },
  actionBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 'var(--font-md)',
    fontWeight: 600,
    color: 'var(--color-info)',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-xs)',
    padding: 'var(--space-xs) 0',
  },
}

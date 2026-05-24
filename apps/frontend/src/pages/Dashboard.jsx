import { useState, useEffect } from 'react'
import { db, ref, onValue, get, query, orderByKey, endAt, push, set } from '../utils/firebase'

/** Convert a timestamp string (ISO or "YYYY-MM-DD HH:mm:ss") to relative time */
function timeAgo(ts) {
  if (!ts) return ''
  const date = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + '+05:30')
  const now = new Date()
  const diffMs = now - date
  const sec = Math.floor(diffMs / 1000)
  if (sec < 10) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.floor(hr / 24)
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

const styles = {
  container: { padding: '1rem', paddingBottom: '5rem' },
  sectionTitle: { fontSize: '0.9rem', fontWeight: '700', color: 'var(--pm-text)', marginBottom: '0.75rem', marginTop: '0.5rem' },
  card: {
    background: 'var(--pm-card-bg)',
    borderRadius: '12px',
    border: '1px solid var(--pm-border)',
    padding: '1rem',
    marginBottom: '0.75rem',
  },
  predRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.7rem 0',
    borderBottom: '1px solid var(--pm-border)',
    cursor: 'pointer',
  },
  predRowLast: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.7rem 0',
    cursor: 'pointer',
  },
  symbol: { fontWeight: '700', fontSize: '0.85rem', color: 'var(--pm-text)' },
  subtext: { fontSize: '0.65rem', color: 'var(--pm-text-muted)' },
  predValues: { textAlign: 'right', fontSize: '0.7rem' },
  predHigh: { color: '#22c55e', fontWeight: '600' },
  predLow: { color: '#ef4444', fontWeight: '600' },
  empty: { textAlign: 'center', padding: '2rem', color: 'var(--pm-text-muted)', fontSize: '0.8rem' },
  // Bottom sheet modal
  overlay: {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.6)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  modal: {
    background: 'var(--pm-card-bg)',
    borderRadius: '16px 16px 0 0',
    width: '100%',
    maxWidth: '480px',
    maxHeight: '75vh',
    display: 'flex',
    flexDirection: 'column',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1.25rem 1.25rem 0.75rem',
    borderBottom: '1px solid var(--pm-border)',
    flexShrink: 0,
  },
  modalTitle: { fontSize: '1.1rem', fontWeight: '700', color: 'var(--pm-text)' },
  modalClose: {
    background: 'none', border: 'none', fontSize: '1.5rem',
    color: 'var(--pm-text-muted)', cursor: 'pointer', padding: '0.25rem',
  },
  modalBody: {
    overflow: 'auto',
    padding: '0 1.25rem',
    paddingBottom: '5rem',
    flex: 1,
  },
  histRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.6rem 0',
    borderBottom: '1px solid var(--pm-border)',
  },
  histDate: { fontWeight: '600', fontSize: '0.8rem', color: 'var(--pm-text)' },
  histActual: { fontSize: '0.65rem', color: 'var(--pm-text-muted)' },
  loadingText: { textAlign: 'center', padding: '2rem', color: 'var(--pm-text-muted)', fontSize: '0.8rem' },
}

export default function Dashboard() {
  const [predictions, setPredictions] = useState({})
  const [stocks, setStocks] = useState({})
  const [selectedSymbol, setSelectedSymbol] = useState(null)
  const [history, setHistory] = useState(null)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [genFrom, setGenFrom] = useState('')
  const [genTo, setGenTo] = useState('')
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    const predRef = ref(db, 'predictions')
    const unsubPred = onValue(predRef, (snap) => setPredictions(snap.val() || {}))
    const stocksRef = ref(db, 'stocks')
    const unsubStocks = onValue(stocksRef, (snap) => setStocks(snap.val() || {}))
    return () => { unsubPred(); unsubStocks() }
  }, [])

  // Get last business day (skip weekends)
  const getLastBusinessDay = () => {
    const now = new Date()
    // Use IST
    const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    const day = ist.getDay() // 0=Sun, 6=Sat
    if (day === 0) ist.setDate(ist.getDate() - 2) // Sun → Fri
    else if (day === 6) ist.setDate(ist.getDate() - 1) // Sat → Fri
    return ist.toISOString().split('T')[0]
  }

  const businessDay = getLastBusinessDay()

  // Get enabled stocks and merge with business day's predictions
  const enabledSymbols = Object.entries(stocks)
    .filter(([, s]) => s.enabled)
    .map(([symbol]) => symbol)
    .sort()

  // Build list: prediction if exists, otherwise show as scheduled
  const rows = enabledSymbols.map((symbol) => {
    const dayData = predictions[symbol]?.[businessDay]
    if (dayData) {
      return { symbol, ...dayData, status: 'predicted' }
    }
    return { symbol, status: 'scheduled' }
  })

  // Open history modal
  const openHistory = async (symbol) => {
    setSelectedSymbol(symbol)
    setHistory(null)
    setLoadingHistory(true)
    try {
      // Load last 30 days of predictions for this symbol
      const predRef = query(
        ref(db, `predictions/${symbol}`),
        orderByKey(),
        endAt(businessDay)
      )
      const snap = await get(predRef)
      const data = snap.val() || {}
      // Sort newest first, limit to last 30
      const entries = Object.entries(data).sort(([a], [b]) => b.localeCompare(a)).slice(0, 30)
      setHistory(entries)
    } catch (e) {
      console.error('Failed to load history:', e)
      setHistory([])
    }
    setLoadingHistory(false)
  }

  return (
    <div style={styles.container}>
      <div style={styles.sectionTitle}>Predictions — {businessDay}</div>
      {rows.length === 0 ? (
        <div style={styles.card}><div style={styles.empty}>No enabled stocks</div></div>
      ) : (
        rows.map((row) => {
          const hasActual = row.status === 'predicted' && row.evaluated && row.actualHigh != null
          // Direction based on predicted midpoint vs reference price (price when prediction was made)
          const midpoint = row.status === 'predicted' ? (row.predictedHigh + row.predictedLow) / 2 : 0
          const refPrice = row.referencePrice
          const direction = (row.status === 'predicted' && refPrice)
            ? (midpoint >= refPrice ? 'Bullish' : 'Bearish')
            : null
          const dirIcon = direction === 'Bullish' ? '▲' : '▼'
          const dirColor = direction === 'Bullish' ? '#22c55e' : '#ef4444'

          return (
            <div key={row.symbol} style={{ ...styles.card, cursor: 'pointer' }} onClick={() => openHistory(row.symbol)}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: row.status === 'predicted' ? '0.5rem' : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={styles.symbol}>{row.symbol}</span>
                  {direction && (
                    <span style={{ fontSize: '0.6rem', fontWeight: '700', color: dirColor }}>
                      {dirIcon} {direction}
                    </span>
                  )}
                  {refPrice && (
                    <span style={{ fontSize: '0.55rem', color: 'var(--pm-text-muted)' }}>
                      @₹{refPrice.toFixed(2)}{row.referencePriceTime ? ` (${row.referencePriceTime})` : ''}
                    </span>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  {row.status === 'predicted' ? (
                    <>
                      <div style={styles.subtext}>{row.modelVersion} • {row.modelType}</div>
                      {row.generatedAt && <div style={{ fontSize: '0.55rem', color: 'var(--pm-text-muted)' }}>{timeAgo(row.generatedAt)}</div>}
                    </>
                  ) : (
                    <span style={{ fontSize: '0.65rem', fontWeight: '600', color: '#f59e0b', background: 'rgba(245,158,11,0.12)', padding: '0.15rem 0.5rem', borderRadius: '4px' }}>
                      Scheduled
                    </span>
                  )}
                </div>
              </div>

              {/* Table for predicted stocks */}
              {row.status === 'predicted' && (
                <div style={{ background: 'var(--pm-bg)', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--pm-border)' }}>
                  {/* Column headers */}
                  <div style={{ display: 'grid', gridTemplateColumns: hasActual ? '1fr 1.2fr 1.2fr 1fr' : '1fr 1.2fr', padding: '0.25rem 0.5rem', borderBottom: '1px solid var(--pm-border)', background: 'rgba(255,255,255,0.03)' }}>
                    <span style={{ fontSize: '0.5rem', color: 'var(--pm-text-muted)', fontWeight: '600' }}></span>
                    <span style={{ fontSize: '0.5rem', color: 'var(--pm-text-muted)', fontWeight: '600', textAlign: 'center' }}>Predicted</span>
                    {hasActual && <span style={{ fontSize: '0.5rem', color: 'var(--pm-text-muted)', fontWeight: '600', textAlign: 'center' }}>Actual</span>}
                    {hasActual && <span style={{ fontSize: '0.5rem', color: 'var(--pm-text-muted)', fontWeight: '600', textAlign: 'center' }}>Error</span>}
                  </div>
                  {/* High row */}
                  <div style={{ display: 'grid', gridTemplateColumns: hasActual ? '1fr 1.2fr 1.2fr 1fr' : '1fr 1.2fr', padding: '0.3rem 0.5rem', borderBottom: '1px solid var(--pm-border)' }}>
                    <span style={{ fontSize: '0.6rem', color: '#22c55e', fontWeight: '600' }}>High</span>
                    <span style={{ fontSize: '0.7rem', fontWeight: '700', color: 'var(--pm-text)', textAlign: 'center' }}>₹{row.predictedHigh?.toFixed(2)}</span>
                    {hasActual && <span style={{ fontSize: '0.7rem', fontWeight: '700', color: 'var(--pm-text)', textAlign: 'center' }}>₹{row.actualHigh?.toFixed(2)}</span>}
                    {hasActual && <span style={{ fontSize: '0.6rem', color: 'var(--pm-text-muted)', textAlign: 'center' }}>{Math.abs(((row.predictedHigh - row.actualHigh) / row.actualHigh) * 100).toFixed(1)}%</span>}
                  </div>
                  {/* Low row */}
                  <div style={{ display: 'grid', gridTemplateColumns: hasActual ? '1fr 1.2fr 1.2fr 1fr' : '1fr 1.2fr', padding: '0.3rem 0.5rem', borderBottom: '1px solid var(--pm-border)' }}>
                    <span style={{ fontSize: '0.6rem', color: '#ef4444', fontWeight: '600' }}>Low</span>
                    <span style={{ fontSize: '0.7rem', fontWeight: '700', color: 'var(--pm-text)', textAlign: 'center' }}>₹{row.predictedLow?.toFixed(2)}</span>
                    {hasActual && <span style={{ fontSize: '0.7rem', fontWeight: '700', color: 'var(--pm-text)', textAlign: 'center' }}>₹{row.actualLow?.toFixed(2)}</span>}
                    {hasActual && <span style={{ fontSize: '0.6rem', color: 'var(--pm-text-muted)', textAlign: 'center' }}>{Math.abs(((row.predictedLow - row.actualLow) / row.actualLow) * 100).toFixed(1)}%</span>}
                  </div>
                  {/* Range row */}
                  <div style={{ display: 'grid', gridTemplateColumns: hasActual ? '1fr 1.2fr 1.2fr 1fr' : '1fr 1.2fr', padding: '0.3rem 0.5rem' }}>
                    <span style={{ fontSize: '0.6rem', color: '#f59e0b', fontWeight: '600' }}>Range</span>
                    <span style={{ fontSize: '0.7rem', fontWeight: '700', color: 'var(--pm-text)', textAlign: 'center' }}>₹{(row.predictedHigh - row.predictedLow).toFixed(2)}</span>
                    {hasActual && <span style={{ fontSize: '0.7rem', fontWeight: '700', color: 'var(--pm-text)', textAlign: 'center' }}>₹{(row.actualHigh - row.actualLow).toFixed(2)}</span>}
                    {hasActual && <span style={{ fontSize: '0.6rem', color: 'var(--pm-text-muted)', textAlign: 'center' }}>{Math.abs((((row.predictedHigh - row.predictedLow) - (row.actualHigh - row.actualLow)) / (row.actualHigh - row.actualLow)) * 100).toFixed(1)}%</span>}
                  </div>
                </div>
              )}
            </div>
          )
        })
      )}

      {/* Historical modal */}
      {selectedSymbol && (
        <div style={styles.overlay} onClick={() => setSelectedSymbol(null)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <span style={styles.modalTitle}>{selectedSymbol} — History</span>
              <button style={styles.modalClose} onClick={() => setSelectedSymbol(null)}>×</button>
            </div>
            <div style={styles.modalBody}>
              {/* Generate predictions section */}
              <div style={{ padding: '0.75rem 0', borderBottom: '1px solid var(--pm-border)', marginBottom: '0.5rem' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: '600', color: 'var(--pm-text)', marginBottom: '0.5rem' }}>Generate Predictions</div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="date"
                    value={genFrom}
                    max={new Date().toISOString().split('T')[0]}
                    onChange={(e) => {
                      setGenFrom(e.target.value)
                      // Auto-cap toDate to fromDate + 30 days
                      if (genTo && e.target.value) {
                        const maxTo = new Date(e.target.value)
                        maxTo.setDate(maxTo.getDate() + 30)
                        const toD = new Date(genTo)
                        if (toD > maxTo) setGenTo(maxTo.toISOString().split('T')[0])
                      }
                    }}
                    style={{ flex: 1, minWidth: '110px', padding: '0.4rem', borderRadius: '6px', border: '1px solid var(--pm-border)', background: 'var(--pm-bg)', color: 'var(--pm-text)', fontSize: '0.7rem' }}
                  />
                  <span style={{ fontSize: '0.7rem', color: 'var(--pm-text-muted)' }}>→</span>
                  <input
                    type="date"
                    value={genTo}
                    min={genFrom || undefined}
                    max={(() => {
                      const today = new Date().toISOString().split('T')[0]
                      if (!genFrom) return today
                      const maxDate = new Date(genFrom)
                      maxDate.setDate(maxDate.getDate() + 30)
                      const maxStr = maxDate.toISOString().split('T')[0]
                      return maxStr < today ? maxStr : today
                    })()}
                    onChange={(e) => setGenTo(e.target.value)}
                    style={{ flex: 1, minWidth: '110px', padding: '0.4rem', borderRadius: '6px', border: '1px solid var(--pm-border)', background: 'var(--pm-bg)', color: 'var(--pm-text)', fontSize: '0.7rem' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <button
                    disabled={!genFrom || !genTo || generating}
                    onClick={async () => {
                      setGenerating(true)
                      try {
                        const pendingRef = ref(db, 'pending_predictions')
                        const newRef = push(pendingRef)
                        await set(newRef, {
                          symbol: selectedSymbol,
                          fromDate: genFrom,
                          toDate: genTo,
                          status: 'pending',
                          createdAt: new Date().toISOString(),
                        })
                        alert(`Queued predictions for ${selectedSymbol}: ${genFrom} → ${genTo}`)
                        setGenFrom('')
                        setGenTo('')
                      } catch (e) {
                        console.error(e)
                        alert('Failed to queue predictions')
                      }
                      setGenerating(false)
                    }}
                    style={{
                      flex: 1, padding: '0.45rem', borderRadius: '6px', border: 'none',
                      background: (!genFrom || !genTo || generating) ? '#555' : '#22c55e',
                      color: '#fff', fontSize: '0.7rem', fontWeight: '600', cursor: 'pointer',
                      opacity: (!genFrom || !genTo || generating) ? 0.5 : 1,
                    }}
                  >
                    {generating ? 'Submitting...' : 'Add to Queue'}
                  </button>
                  <button
                    onClick={() => { setGenFrom(''); setGenTo('') }}
                    style={{
                      padding: '0.45rem 0.75rem', borderRadius: '6px',
                      border: '1px solid var(--pm-border)', background: 'transparent',
                      color: 'var(--pm-text-muted)', fontSize: '0.7rem', cursor: 'pointer',
                    }}
                  >
                    Reset
                  </button>
                </div>
              </div>

              {loadingHistory ? (
                <div style={styles.loadingText}>Loading...</div>
              ) : history && history.length === 0 ? (
                <div style={styles.loadingText}>No historical predictions</div>
              ) : history && history.map(([date, pred]) => {
                const hasActual = pred.evaluated && pred.actualHigh != null
                // Direction based on predicted midpoint vs reference price
                const midPred = (pred.predictedHigh + pred.predictedLow) / 2
                const refP = pred.referencePrice
                const direction = refP ? (midPred >= refP ? 'Bullish' : 'Bearish') : null
                const dirIcon = direction === 'Bullish' ? '▲' : '▼'
                const dirColor = direction === 'Bullish' ? '#22c55e' : '#ef4444'

                return (
                  <div key={date} style={{ padding: '0.75rem 0', borderBottom: '1px solid var(--pm-border)' }}>
                    {/* Header row */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: '700', fontSize: '0.8rem', color: 'var(--pm-text)' }}>{date}</span>
                        {direction && (
                          <span style={{ fontSize: '0.6rem', fontWeight: '700', color: dirColor }}>
                            {dirIcon} {direction}
                          </span>
                        )}
                        {refP && (
                          <span style={{ fontSize: '0.5rem', color: 'var(--pm-text-muted)' }}>
                            @₹{refP.toFixed(2)}{pred.referencePriceTime ? ` (${pred.referencePriceTime})` : ''}
                          </span>
                        )}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.55rem', color: 'var(--pm-text-muted)' }}>{pred.modelVersion}</div>
                        {pred.generatedAt && (
                          <div style={{ fontSize: '0.5rem', color: 'var(--pm-text-muted)' }}>
                            {timeAgo(pred.generatedAt)}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Table: rows=High/Low/Return, cols=Predicted/Actual/Error */}
                    <div style={{ background: 'var(--pm-bg)', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--pm-border)' }}>
                      {/* Column headers */}
                      <div style={{ display: 'grid', gridTemplateColumns: hasActual ? '1fr 1.2fr 1.2fr 1fr' : '1fr 1.2fr', padding: '0.3rem 0.5rem', borderBottom: '1px solid var(--pm-border)', background: 'rgba(255,255,255,0.03)' }}>
                        <span style={{ fontSize: '0.55rem', color: 'var(--pm-text-muted)', fontWeight: '600' }}></span>
                        <span style={{ fontSize: '0.55rem', color: 'var(--pm-text-muted)', fontWeight: '600', textAlign: 'center' }}>Predicted</span>
                        {hasActual && <span style={{ fontSize: '0.55rem', color: 'var(--pm-text-muted)', fontWeight: '600', textAlign: 'center' }}>Actual</span>}
                        {hasActual && <span style={{ fontSize: '0.55rem', color: 'var(--pm-text-muted)', fontWeight: '600', textAlign: 'center' }}>Error</span>}
                      </div>
                      {/* High row */}
                      <div style={{ display: 'grid', gridTemplateColumns: hasActual ? '1fr 1.2fr 1.2fr 1fr' : '1fr 1.2fr', padding: '0.35rem 0.5rem', borderBottom: '1px solid var(--pm-border)' }}>
                        <span style={{ fontSize: '0.6rem', color: '#22c55e', fontWeight: '600' }}>High</span>
                        <span style={{ fontSize: '0.7rem', fontWeight: '700', color: 'var(--pm-text)', textAlign: 'center' }}>₹{pred.predictedHigh?.toFixed(2)}</span>
                        {hasActual && <span style={{ fontSize: '0.7rem', fontWeight: '700', color: 'var(--pm-text)', textAlign: 'center' }}>₹{pred.actualHigh?.toFixed(2)}</span>}
                        {hasActual && <span style={{ fontSize: '0.6rem', color: 'var(--pm-text-muted)', textAlign: 'center' }}>{Math.abs(((pred.predictedHigh - pred.actualHigh) / pred.actualHigh) * 100).toFixed(1)}%</span>}
                      </div>
                      {/* Low row */}
                      <div style={{ display: 'grid', gridTemplateColumns: hasActual ? '1fr 1.2fr 1.2fr 1fr' : '1fr 1.2fr', padding: '0.35rem 0.5rem', borderBottom: '1px solid var(--pm-border)' }}>
                        <span style={{ fontSize: '0.6rem', color: '#ef4444', fontWeight: '600' }}>Low</span>
                        <span style={{ fontSize: '0.7rem', fontWeight: '700', color: 'var(--pm-text)', textAlign: 'center' }}>₹{pred.predictedLow?.toFixed(2)}</span>
                        {hasActual && <span style={{ fontSize: '0.7rem', fontWeight: '700', color: 'var(--pm-text)', textAlign: 'center' }}>₹{pred.actualLow?.toFixed(2)}</span>}
                        {hasActual && <span style={{ fontSize: '0.6rem', color: 'var(--pm-text-muted)', textAlign: 'center' }}>{Math.abs(((pred.predictedLow - pred.actualLow) / pred.actualLow) * 100).toFixed(1)}%</span>}
                      </div>
                      {/* Range/Return row */}
                      <div style={{ display: 'grid', gridTemplateColumns: hasActual ? '1fr 1.2fr 1.2fr 1fr' : '1fr 1.2fr', padding: '0.35rem 0.5rem' }}>
                        <span style={{ fontSize: '0.6rem', color: '#f59e0b', fontWeight: '600' }}>Range</span>
                        <span style={{ fontSize: '0.7rem', fontWeight: '700', color: 'var(--pm-text)', textAlign: 'center' }}>₹{(pred.predictedHigh - pred.predictedLow).toFixed(2)}</span>
                        {hasActual && <span style={{ fontSize: '0.7rem', fontWeight: '700', color: 'var(--pm-text)', textAlign: 'center' }}>₹{(pred.actualHigh - pred.actualLow).toFixed(2)}</span>}
                        {hasActual && <span style={{ fontSize: '0.6rem', color: 'var(--pm-text-muted)', textAlign: 'center' }}>{Math.abs((((pred.predictedHigh - pred.predictedLow) - (pred.actualHigh - pred.actualLow)) / (pred.actualHigh - pred.actualLow)) * 100).toFixed(1)}%</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

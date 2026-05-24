import { useState, useEffect } from 'react'
import { db, ref, onValue, get, query, orderByKey, startAt, endAt } from '../utils/firebase'

const styles = {
  container: { padding: '1rem', paddingBottom: '5rem' },
  sectionTitle: { fontSize: '0.9rem', fontWeight: '700', color: 'var(--pm-text)', marginBottom: '0.75rem', marginTop: '1rem' },
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
    padding: '0.6rem 0',
    borderBottom: '1px solid var(--pm-border)',
  },
  predRowLast: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.6rem 0',
  },
  symbol: { fontWeight: '700', fontSize: '0.85rem', color: 'var(--pm-text)' },
  subtext: { fontSize: '0.65rem', color: 'var(--pm-text-muted)' },
  predValues: { textAlign: 'right', fontSize: '0.7rem', color: 'var(--pm-text-muted)' },
  predHigh: { color: '#22c55e', fontWeight: '600' },
  predLow: { color: '#ef4444', fontWeight: '600' },
  badge: { padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.6rem', fontWeight: '600' },
  badgeGreen: { background: 'rgba(34, 197, 94, 0.15)', color: '#22c55e' },
  badgeRed: { background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' },
  badgeBlue: { background: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6' },
  empty: { textAlign: 'center', padding: '1.5rem', color: 'var(--pm-text-muted)', fontSize: '0.8rem' },
  // Historical filter
  filterRow: {
    display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', alignItems: 'center', flexWrap: 'wrap',
  },
  select: {
    flex: 1, padding: '0.5rem 0.6rem', borderRadius: '8px',
    border: '1px solid var(--pm-border)', background: 'var(--pm-card-bg)',
    color: 'var(--pm-text)', fontSize: '0.8rem', outline: 'none',
  },
  dateInput: {
    padding: '0.5rem 0.6rem', borderRadius: '8px',
    border: '1px solid var(--pm-border)', background: 'var(--pm-card-bg)',
    color: 'var(--pm-text)', fontSize: '0.75rem', outline: 'none',
  },
  loadBtn: {
    padding: '0.5rem 0.8rem', borderRadius: '8px', border: 'none',
    background: 'var(--pm-primary)', color: '#fff',
    fontWeight: '600', fontSize: '0.75rem', cursor: 'pointer',
  },
  histDate: { fontSize: '0.7rem', fontWeight: '600', color: 'var(--pm-text)', padding: '0.5rem 0 0.2rem' },
}

function PredictionCard({ pred, isLast }) {
  return (
    <div style={isLast ? styles.predRowLast : styles.predRow}>
      <div>
        <div style={styles.symbol}>{pred.symbol || pred.date}</div>
        <div style={styles.subtext}>
          {pred.modelVersion} • {pred.modelType}
          {pred.generatedAt ? ` • ${pred.generatedAt.split(' ')[1] || ''}` : ''}
        </div>
      </div>
      <div style={styles.predValues}>
        <div style={styles.predHigh}>H: ₹{pred.predictedHigh?.toFixed(2)}</div>
        <div style={styles.predLow}>L: ₹{pred.predictedLow?.toFixed(2)}</div>
        {pred.evaluated && pred.actualHigh != null && (
          <div style={styles.subtext}>
            A: ₹{pred.actualHigh?.toFixed(0)}–{pred.actualLow?.toFixed(0)}
          </div>
        )}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [predictions, setPredictions] = useState({})
  const [stocks, setStocks] = useState({})

  // Historical state
  const [selectedStock, setSelectedStock] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [historicalData, setHistoricalData] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const predRef = ref(db, 'predictions')
    const unsubPred = onValue(predRef, (snap) => setPredictions(snap.val() || {}))
    const stocksRef = ref(db, 'stocks')
    const unsubStocks = onValue(stocksRef, (snap) => setStocks(snap.val() || {}))
    return () => { unsubPred(); unsubStocks() }
  }, [])

  const today = new Date().toISOString().split('T')[0]

  // Today's predictions across all symbols
  const todayPredictions = Object.entries(predictions).flatMap(([symbol, dates]) => {
    const todayData = dates?.[today]
    if (!todayData) return []
    return [{ symbol, ...todayData }]
  })

  // Stock list for dropdown
  const stockSymbols = Object.keys(stocks).sort()

  // Load historical predictions
  const loadHistorical = async () => {
    if (!selectedStock || !fromDate || !toDate) return
    setLoading(true)
    try {
      const predRef = query(
        ref(db, `predictions/${selectedStock}`),
        orderByKey(),
        startAt(fromDate),
        endAt(toDate)
      )
      const snap = await get(predRef)
      const data = snap.val() || {}
      setHistoricalData(data)
    } catch (e) {
      console.error('Failed to load historical:', e)
      setHistoricalData({})
    }
    setLoading(false)
  }

  const historicalEntries = historicalData
    ? Object.entries(historicalData).sort(([a], [b]) => b.localeCompare(a))
    : null

  return (
    <div style={styles.container}>
      {/* Today's Predictions */}
      <div style={styles.sectionTitle}>Today's Predictions</div>
      <div style={styles.card}>
        {todayPredictions.length === 0 ? (
          <div style={styles.empty}>No predictions for {today}</div>
        ) : (
          todayPredictions.map((pred, i) => (
            <PredictionCard key={pred.symbol} pred={pred} isLast={i === todayPredictions.length - 1} />
          ))
        )}
      </div>

      {/* Historical Predictions */}
      <div style={styles.sectionTitle}>Historical Predictions</div>

      <div style={styles.filterRow}>
        <select
          style={styles.select}
          value={selectedStock}
          onChange={(e) => { setSelectedStock(e.target.value); setHistoricalData(null) }}
        >
          <option value="">Select stock...</option>
          {stockSymbols.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div style={styles.filterRow}>
        <input
          type="date"
          style={styles.dateInput}
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          placeholder="From"
        />
        <input
          type="date"
          style={styles.dateInput}
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          placeholder="To"
        />
        <button
          style={{ ...styles.loadBtn, opacity: (!selectedStock || !fromDate || !toDate) ? 0.5 : 1 }}
          onClick={loadHistorical}
          disabled={!selectedStock || !fromDate || !toDate || loading}
        >
          {loading ? '...' : 'Load'}
        </button>
      </div>

      {historicalEntries === null ? (
        <div style={styles.empty}>Select a stock and date range to view predictions</div>
      ) : historicalEntries.length === 0 ? (
        <div style={styles.card}>
          <div style={styles.empty}>No predictions found for {selectedStock} in this range</div>
        </div>
      ) : (
        <div style={styles.card}>
          {historicalEntries.map(([date, pred], i) => (
            <PredictionCard
              key={date}
              pred={{ ...pred, symbol: date }}
              isLast={i === historicalEntries.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

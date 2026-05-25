import { useState, useEffect } from 'react'
import moment from 'moment'
import { db, ref, onValue, onChildAdded, off, get } from '../utils/firebase'
import { layout } from '../utils/styles'
import PortfolioChart from '../components/PortfolioChart'
import TradeList from '../components/TradeList'

const dropdownStyles = {
  wrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.75rem 1rem',
  },
  label: {
    fontSize: '0.8rem',
    fontWeight: '600',
    color: 'var(--pm-text-secondary)',
  },
  select: {
    flex: 1,
    padding: '0.5rem 0.75rem',
    borderRadius: '8px',
    border: '1px solid var(--pm-border)',
    background: 'var(--pm-card-bg)',
    color: 'var(--pm-text)',
    fontSize: '0.8rem',
    fontWeight: '600',
    outline: 'none',
    cursor: 'pointer',
    appearance: 'none',
    WebkitAppearance: 'none',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%239ca3af' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 0.75rem center',
    paddingRight: '2rem',
  },
}

export default function Home() {
  const [stocks, setStocks] = useState({})
  const [selectedSymbol, setSelectedSymbol] = useState('')
  const [ticks, setTicks] = useState([])
  const [signals, setSignals] = useState([])
  const [prediction, setPrediction] = useState(null)

  const isDryRun = new URLSearchParams(window.location.search).has('dryRun')
  const today = moment().utcOffset('+05:30').format('YYYY-MM-DD')

  // Load enabled stocks from Firebase
  useEffect(() => {
    if (isDryRun) return
    const stocksRef = ref(db, 'stocks')
    const unsub = onValue(stocksRef, (snap) => {
      const data = snap.val() || {}
      const enabled = Object.fromEntries(
        Object.entries(data).filter(([, s]) => s.enabled)
      )
      setStocks(enabled)
      // Auto-select first stock if none selected
      const symbols = Object.keys(enabled).sort()
      if (symbols.length > 0 && !selectedSymbol) {
        setSelectedSymbol(symbols[0])
      }
    })
    return () => unsub()
  }, [isDryRun])

  // Load ticks and signals for the selected stock
  useEffect(() => {
    if (isDryRun) {
      fetch('/dry-run-output.json')
        .then((res) => res.json())
        .then((data) => {
          setTicks(data.ticks || [])
          setSignals(data.signals || [])
        })
        .catch((err) => console.error('Failed to load dry-run data:', err))
      return
    }

    if (!selectedSymbol) return

    setTicks([])
    setSignals([])

    const pricesRef = ref(db, `prices/${selectedSymbol}`)
    const signalsRef = ref(db, `signals/${selectedSymbol}`)

    onChildAdded(pricesRef, (snapshot) => {
      const tick = snapshot.val()
      setTicks((prev) => [...prev, tick])
    })

    onChildAdded(signalsRef, (snapshot) => {
      const signal = snapshot.val()
      setSignals((prev) => [...prev, signal])
    })

    return () => {
      off(pricesRef)
      off(signalsRef)
    }
  }, [isDryRun, selectedSymbol])

  // Load today's prediction for the selected stock
  useEffect(() => {
    if (isDryRun || !selectedSymbol) { setPrediction(null); return }
    const predRef = ref(db, `predictions/${selectedSymbol}/${today}`)
    const unsub = onValue(predRef, (snap) => {
      setPrediction(snap.val() || null)
    })
    return () => unsub()
  }, [isDryRun, selectedSymbol, today])

  const enabledSymbols = Object.keys(stocks).sort()

  // Direction is stored in the prediction (based on predictedClose vs referencePrice)
  const direction = prediction?.direction || null

  return (
    <div style={{ ...layout.page, paddingBottom: '4rem' }}>
      {/* Stock selector dropdown */}
      {!isDryRun && enabledSymbols.length > 0 && (
        <div style={dropdownStyles.wrapper}>
          <span style={dropdownStyles.label}>Stock</span>
          <select
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value)}
            style={dropdownStyles.select}
          >
            {enabledSymbols.map((sym) => (
              <option key={sym} value={sym}>
                {sym} — {stocks[sym]?.name || sym}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Direction badge + confidence + last updated */}
      {direction && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0.25rem 0', gap: '0.2rem' }}>
          <span style={{
            fontSize: '0.7rem', fontWeight: '700',
            color: direction === 'Bullish' ? '#22c55e' : '#ef4444',
            background: direction === 'Bullish' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            padding: '0.25rem 0.75rem', borderRadius: '12px',
          }}>
            {direction === 'Bullish' ? '▲' : '▼'} {direction} • H: ₹{prediction.predictedHigh.toFixed(1)} • L: ₹{prediction.predictedLow.toFixed(1)} • C: ₹{prediction.predictedClose.toFixed(1)}
          </span>
          {prediction.confidence != null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.15rem' }}>
              <div style={{
                width: '60px', height: '4px', borderRadius: '2px',
                background: 'var(--pm-border)',
                overflow: 'hidden',
              }}>
                <div style={{
                  width: `${Math.round(prediction.confidence * 100)}%`,
                  height: '100%',
                  borderRadius: '2px',
                  background: prediction.confidence >= 0.7 ? '#22c55e' : prediction.confidence >= 0.4 ? '#f59e0b' : '#ef4444',
                }} />
              </div>
              <span style={{
                fontSize: '0.6rem', fontWeight: '600',
                color: prediction.confidence >= 0.7 ? '#22c55e' : prediction.confidence >= 0.4 ? '#f59e0b' : '#ef4444',
              }}>
                {Math.round(prediction.confidence * 100)}% confidence
              </span>
            </div>
          )}
          {prediction.updatedAt && (
            <span style={{ fontSize: '0.6rem', color: 'var(--pm-text-secondary)' }}>
              Updated {moment(prediction.updatedAt, 'YYYY-MM-DD HH:mm:ss').fromNow()}
              {prediction.windowSize ? ` • ${prediction.windowSize}min window` : ''}
            </span>
          )}
        </div>
      )}

      <PortfolioChart
        name={stocks[selectedSymbol]?.name || selectedSymbol || 'Select Stock'}
        ticker={selectedSymbol || '?'}
        ticks={ticks}
        signals={signals}
        predictedHigh={prediction?.predictedHigh || null}
        predictedLow={prediction?.predictedLow || null}
        predictedClose={prediction?.predictedClose || null}
      />

      <TradeList signals={signals} />
    </div>
  )
}

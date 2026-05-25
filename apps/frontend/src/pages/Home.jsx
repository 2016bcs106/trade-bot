import { useState, useEffect } from 'react'
import moment from 'moment'
import { db, ref, onValue, onChildAdded, off, get, push } from '../utils/firebase'
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

const btnStyles = {
  predict: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.4rem',
    margin: '0.5rem 1rem',
    padding: '0.6rem 1rem',
    borderRadius: '10px',
    border: 'none',
    background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
    color: '#fff',
    fontSize: '0.8rem',
    fontWeight: '600',
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
  },
  toggle: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    margin: '0 1rem 0.5rem',
    padding: '0.4rem 0.75rem',
    borderRadius: '8px',
    border: '1px solid var(--pm-border)',
    background: 'var(--pm-card-bg)',
    fontSize: '0.7rem',
    fontWeight: '600',
    color: 'var(--pm-text-secondary)',
    cursor: 'pointer',
  },
  toggleActive: {
    border: '1px solid #8b5cf6',
    background: 'rgba(139,92,246,0.1)',
    color: '#8b5cf6',
  },
}

const sheetStyles = {
  overlay: {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  sheet: {
    width: '100%',
    maxWidth: '500px',
    background: 'var(--pm-card-bg)',
    borderRadius: '16px 16px 0 0',
    padding: '1.5rem',
    boxShadow: '0 -4px 20px rgba(0,0,0,0.2)',
  },
  title: {
    fontSize: '1rem',
    fontWeight: '700',
    color: 'var(--pm-text)',
    marginBottom: '1rem',
  },
  input: {
    width: '100%',
    padding: '0.75rem',
    borderRadius: '8px',
    border: '1px solid var(--pm-border)',
    background: 'var(--pm-bg)',
    color: 'var(--pm-text)',
    fontSize: '0.85rem',
    marginBottom: '1rem',
    outline: 'none',
    boxSizing: 'border-box',
  },
  submit: {
    width: '100%',
    padding: '0.75rem',
    borderRadius: '10px',
    border: 'none',
    background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
    color: '#fff',
    fontSize: '0.85rem',
    fontWeight: '600',
    cursor: 'pointer',
  },
  submitDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  cancel: {
    width: '100%',
    padding: '0.6rem',
    borderRadius: '8px',
    border: 'none',
    background: 'transparent',
    color: 'var(--pm-text-secondary)',
    fontSize: '0.8rem',
    cursor: 'pointer',
    marginTop: '0.5rem',
  },
}

export default function Home() {
  const [stocks, setStocks] = useState({})
  const [selectedSymbol, setSelectedSymbol] = useState('')
  const [ticks, setTicks] = useState([])
  const [signals, setSignals] = useState([])
  const [prediction, setPrediction] = useState(null)

  // Dry run state
  const [showDryRun, setShowDryRun] = useState(false)
  const [dryRunData, setDryRunData] = useState([])

  // Bottom sheet state
  const [sheetOpen, setSheetOpen] = useState(false)
  const [dateInput, setDateInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState(null) // 'success' | 'error'

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

  // Load dry run data when toggle is on
  useEffect(() => {
    if (!showDryRun || !selectedSymbol) {
      setDryRunData([])
      return
    }

    const dryRunRef = ref(db, `short_horizon_predictions_dry_run/${selectedSymbol}`)
    const unsub = onValue(dryRunRef, (snap) => {
      const data = snap.val()
      if (!data) { setDryRunData([]); return }

      // Flatten: data is { date: { time: record } }
      const records = []
      for (const [date, times] of Object.entries(data)) {
        if (typeof times !== 'object' || !times) continue
        for (const [timeKey, record] of Object.entries(times)) {
          if (timeKey === '_summary') continue
          records.push({ ...record, date })
        }
      }

      // Sort by time and convert to tick-like format for the chart
      records.sort((a, b) => {
        const timeA = a.time || ''
        const timeB = b.time || ''
        return timeA.localeCompare(timeB)
      })

      // Convert to chart-compatible format: actual + predicted lines
      const chartData = records.map((r) => ({
        time: r.time,
        price: r.actualPrice,
        predictedPrice: r.predictedPrice,
        direction: r.direction,
        confidence: r.confidence,
        directionCorrect: r.directionCorrect,
      }))

      setDryRunData(chartData)
    })

    return () => unsub()
  }, [showDryRun, selectedSymbol])

  // Submit dry run request
  const handleSubmitDryRun = async () => {
    if (!dateInput || !selectedSymbol || submitting) return
    setSubmitting(true)
    setSubmitStatus(null)

    try {
      const queueRef = ref(db, 'request_queue')
      await push(queueRef, {
        type: 'short_predict_dry_run',
        payload: { symbol: selectedSymbol, date: dateInput },
        status: 'pending',
        createdAt: new Date().toISOString(),
      })
      setSubmitStatus('success')
      setTimeout(() => {
        setSheetOpen(false)
        setSubmitStatus(null)
        setDateInput('')
      }, 1500)
    } catch (err) {
      console.error('Failed to submit dry run request:', err)
      setSubmitStatus('error')
    } finally {
      setSubmitting(false)
    }
  }

  const enabledSymbols = Object.keys(stocks).sort()

  // Direction is stored in the prediction (based on predictedClose vs referencePrice)
  const direction = prediction?.direction || null

  // Determine which ticks to show on chart
  const chartTicks = showDryRun ? dryRunData.map((d) => ({
    price: d.price,
    time: d.time,
    predicted: d.predictedPrice,
  })) : ticks

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
      {direction && !showDryRun && (
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

      {/* Dry run summary badge */}
      {showDryRun && dryRunData.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '0.25rem 0' }}>
          <span style={{
            fontSize: '0.7rem', fontWeight: '600',
            color: '#8b5cf6',
            background: 'rgba(139,92,246,0.1)',
            padding: '0.25rem 0.75rem', borderRadius: '12px',
          }}>
            🔮 Dry Run: {dryRunData.length} predictions • {dryRunData.filter(d => d.directionCorrect).length}/{dryRunData.length} correct ({Math.round(dryRunData.filter(d => d.directionCorrect).length / dryRunData.length * 100)}%)
          </span>
        </div>
      )}

      <PortfolioChart
        name={stocks[selectedSymbol]?.name || selectedSymbol || 'Select Stock'}
        ticker={selectedSymbol || '?'}
        ticks={showDryRun ? dryRunData : ticks}
        signals={showDryRun ? [] : signals}
        predictedHigh={showDryRun ? null : (prediction?.predictedHigh || null)}
        predictedLow={showDryRun ? null : (prediction?.predictedLow || null)}
        predictedClose={showDryRun ? null : (prediction?.predictedClose || null)}
        isDryRun={showDryRun}
      />

      {/* Action row: Predict button + Dry Run toggle */}
      {!isDryRun && selectedSymbol && (
        <div style={{ display: 'flex', gap: '0.5rem', padding: '0 1rem', marginTop: '0.5rem' }}>
          <button
            style={btnStyles.predict}
            onClick={() => { setSheetOpen(true); setSubmitStatus(null) }}
          >
            🔮 Predict 5min
          </button>
          <button
            style={{
              ...btnStyles.toggle,
              ...(showDryRun ? btnStyles.toggleActive : {}),
            }}
            onClick={() => setShowDryRun(!showDryRun)}
          >
            <span style={{
              width: '28px', height: '16px', borderRadius: '8px',
              background: showDryRun ? '#8b5cf6' : 'var(--pm-border)',
              position: 'relative', display: 'inline-block', transition: 'background 0.2s',
            }}>
              <span style={{
                width: '12px', height: '12px', borderRadius: '50%',
                background: '#fff', position: 'absolute', top: '2px',
                left: showDryRun ? '14px' : '2px', transition: 'left 0.2s',
              }} />
            </span>
            Dry Run
          </button>
        </div>
      )}

      {!showDryRun && <TradeList signals={signals} />}

      {/* Bottom Sheet Modal */}
      {sheetOpen && (
        <div style={sheetStyles.overlay} onClick={() => setSheetOpen(false)}>
          <div style={sheetStyles.sheet} onClick={(e) => e.stopPropagation()}>
            <div style={sheetStyles.title}>Generate Short-Horizon Predictions</div>
            <p style={{ fontSize: '0.75rem', color: 'var(--pm-text-secondary)', marginBottom: '1rem' }}>
              Run the 5-min predictor on a past trading day for <strong>{selectedSymbol}</strong>. Results will appear in the Dry Run view.
            </p>
            <input
              type="date"
              value={dateInput}
              onChange={(e) => setDateInput(e.target.value)}
              style={sheetStyles.input}
              max={moment().subtract(1, 'day').format('YYYY-MM-DD')}
            />
            <button
              style={{
                ...sheetStyles.submit,
                ...(submitting || !dateInput ? sheetStyles.submitDisabled : {}),
              }}
              onClick={handleSubmitDryRun}
              disabled={submitting || !dateInput}
            >
              {submitting ? 'Submitting...' : submitStatus === 'success' ? '✓ Request Queued!' : 'Run Dry Prediction'}
            </button>
            {submitStatus === 'error' && (
              <p style={{ fontSize: '0.7rem', color: '#ef4444', textAlign: 'center', marginTop: '0.5rem' }}>
                Failed to submit request. Try again.
              </p>
            )}
            <button style={sheetStyles.cancel} onClick={() => setSheetOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

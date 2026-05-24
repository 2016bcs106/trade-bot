import { useState, useEffect } from 'react'
import { db, ref, onValue, onChildAdded, off } from '../utils/firebase'
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

  const isDryRun = new URLSearchParams(window.location.search).has('dryRun')

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

  const enabledSymbols = Object.keys(stocks).sort()

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

      <PortfolioChart
        name={stocks[selectedSymbol]?.name || selectedSymbol || 'Select Stock'}
        ticker={selectedSymbol || '?'}
        ticks={ticks}
        signals={signals}
      />

      <TradeList signals={signals} />
    </div>
  )
}

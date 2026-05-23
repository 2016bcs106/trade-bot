import { useState, useEffect } from 'react'
import { db, ref, onChildAdded, off } from '../utils/firebase'
import { layout, text, header } from '../utils/styles'
import PortfolioChart from '../components/PortfolioChart'
import TradeList from '../components/TradeList'

export default function Home() {
  const [ticks, setTicks] = useState([])
  const [signals, setSignals] = useState([])

  const isDryRun = new URLSearchParams(window.location.search).has('dryRun')

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

    const pricesRef = ref(db, 'prices')
    const signalsRef = ref(db, 'signals')

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
  }, [isDryRun])

  return (
    <div style={{ ...layout.page, paddingBottom: '4rem' }}>
      <header style={header.bar}>
        <span style={text.logo}>Trade Bot</span>
        {isDryRun && (
          <span style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem', borderRadius: '4px', background: '#fef3c7', color: '#92400e', fontWeight: 600 }}>
            DRY RUN
          </span>
        )}
      </header>

      <PortfolioChart ticks={ticks} signals={signals} />

      <TradeList signals={signals} />
    </div>
  )
}

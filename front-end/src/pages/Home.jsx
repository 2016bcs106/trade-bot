import { useState, useEffect, useCallback } from 'react'
import { db, ref, onChildAdded, off } from '../utils/firebase'
import { clearAuth } from '../utils/auth'
import { layout, text, button, header } from '../utils/styles'
import PortfolioChart from '../components/PortfolioChart'
import TradeList from '../components/TradeList'

export default function Home() {
  const [ticks, setTicks] = useState([])
  const [signals, setSignals] = useState([])

  useEffect(() => {
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
  }, [])

  function handleLogout() {
    clearAuth()
    window.location.href = '/login'
  }

  return (
    <div style={layout.page}>
      <header style={header.bar}>
        <span style={text.logo}>Trade Bot</span>
        <button
          style={button.outline}
          onClick={handleLogout}
          onMouseOver={(e) => e.target.style.background = 'var(--pm-bg)'}
          onMouseOut={(e) => e.target.style.background = 'transparent'}
        >
          Logout
        </button>
      </header>

      <PortfolioChart ticks={ticks} signals={signals} />

      <TradeList signals={signals} />
    </div>
  )
}

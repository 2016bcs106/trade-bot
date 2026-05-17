import { useSearchParams } from 'react-router-dom'
import { clearAuth } from '../utils/auth'
import { layout, card, text, button, header, merge } from '../utils/styles'
import PortfolioChart from '../components/PortfolioChart'

export default function Home() {
  const [searchParams] = useSearchParams()

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

      <PortfolioChart
        signals={[
          { time: '09:10', signal: 'BUY' },
          { time: '09:35', signal: 'SELL' },
          { time: '10:05', signal: 'BUY' },
          { time: '10:40', signal: 'SELL' },
          { time: '11:15', signal: 'BUY' },
          { time: '12:00', signal: 'SELL' },
          { time: '12:45', signal: 'BUY' },
          { time: '13:20', signal: 'SELL' },
          { time: '14:00', signal: 'BUY' },
          { time: '14:50', signal: 'SELL' },
        ]}
      />

      <div style={merge(layout.center, { flex: 1 })}>
        <div style={merge(card.base, { padding: '3rem 4rem', textAlign: 'center' })}>
          <h1 style={merge(text.heroHeading, { marginBottom: '0.5rem' })}>Hello World 👋</h1>
          <p style={text.muted}>Session valid until midnight today</p>
        </div>
      </div>
    </div>
  )
}

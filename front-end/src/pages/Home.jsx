import { clearAuth } from '../utils/auth'
import { layout, text, button, header } from '../utils/styles'
import PortfolioChart from '../components/PortfolioChart'
import TradeList from '../components/TradeList'

const mockSignals = [
  { time: '09:10', signal: 'BUY', triggerPrice: 2710.50, gain: 0, status: 'success' },
  { time: '09:35', signal: 'SELL', triggerPrice: 2718.20, gain: 7.70, status: 'success' },
  { time: '10:05', signal: 'BUY', triggerPrice: 2705.30, gain: 0, status: 'dry-run' },
  { time: '10:40', signal: 'SELL', triggerPrice: 2712.80, gain: 7.50, status: 'dry-run' },
  { time: '11:15', signal: 'BUY', triggerPrice: 2700.10, gain: 0, status: 'pending' },
  { time: '12:00', signal: 'SELL', triggerPrice: 2695.40, gain: -4.70, status: 'failed' },
  { time: '12:45', signal: 'BUY', triggerPrice: 2698.90, gain: 0, status: 'success' },
  { time: '13:20', signal: 'SELL', triggerPrice: 2715.60, gain: 16.70, status: 'success' },
  { time: '14:00', signal: 'BUY', triggerPrice: 2720.00, gain: 0, status: 'pending' },
  { time: '14:50', signal: 'SELL', triggerPrice: 2708.30, gain: -11.70, status: 'failed' },
]

export default function Home() {
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

      <PortfolioChart signals={mockSignals} />

      <TradeList signals={mockSignals} />
    </div>
  )
}

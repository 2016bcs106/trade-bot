import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import GoogleAuthGuard from './components/GoogleAuthGuard'
import AuthGuard from './components/AuthGuard'
import BottomNav from './components/BottomNav'
import { AppProvider } from './context/AppContext'
import Login from './pages/Login'
import Stocks from './pages/Stocks'
import Monitor from './pages/Monitor'
import Settings from './pages/Settings'
import PaytmMoneyCallback from './pages/PaytmMoneyCallback'
import LiveTicks from './pages/LiveTicks'
import Portfolio from './pages/portfolio/Portfolio'
import PortfolioHoldings from './pages/portfolio/PortfolioHoldings'
import PortfolioPositions from './pages/portfolio/PortfolioPositions'

const isDryRun = new URLSearchParams(window.location.search).has('dryRun')

function App() {
  if (isDryRun) {
    return <LiveTicks />
  }

  return (
    <GoogleAuthGuard>
      <AppProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/paytm-money-callback" element={<PaytmMoneyCallback />} />
            <Route path="/" element={<AuthGuard><Stocks /></AuthGuard>} />
            <Route path="/live/:symbol" element={<AuthGuard><LiveTicks /></AuthGuard>} />
            <Route path="/portfolio" element={<AuthGuard><Portfolio /></AuthGuard>} />
            <Route path="/portfolio/holdings" element={<AuthGuard><PortfolioHoldings /></AuthGuard>} />
            <Route path="/portfolio/positions" element={<AuthGuard><PortfolioPositions /></AuthGuard>} />
            <Route path="/monitor" element={<AuthGuard><Monitor /></AuthGuard>} />
            <Route path="/settings" element={<AuthGuard><Settings /></AuthGuard>} />
          </Routes>
          <BottomNav />
        </BrowserRouter>
      </AppProvider>
    </GoogleAuthGuard>
  )
}

export default App

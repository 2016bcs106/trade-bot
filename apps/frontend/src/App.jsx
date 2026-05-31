import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AuthGuard from './components/AuthGuard'
import BottomNav from './components/BottomNav'
import { LiveTicksProvider } from './context/LiveTicksContext'
import Login from './pages/Login'
import Stocks from './pages/Stocks'
import Monitor from './pages/Monitor'
import Settings from './pages/Settings'
import PaytmMoneyCallback from './pages/PaytmMoneyCallback'
import LiveTicks from './pages/LiveTicks'

const isDryRun = new URLSearchParams(window.location.search).has('dryRun')

function App() {
  if (isDryRun) {
    return <LiveTicks />
  }

  return (
    <LiveTicksProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/paytm-money-callback" element={<PaytmMoneyCallback />} />
          <Route path="/" element={<AuthGuard><LiveTicks /></AuthGuard>} />
          <Route path="/stocks" element={<AuthGuard><Stocks /></AuthGuard>} />
          <Route path="/monitor" element={<AuthGuard><Monitor /></AuthGuard>} />
          <Route path="/settings" element={<AuthGuard><Settings /></AuthGuard>} />
        </Routes>
        <BottomNav />
      </BrowserRouter>
    </LiveTicksProvider>
  )
}

export default App

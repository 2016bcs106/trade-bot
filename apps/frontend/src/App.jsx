import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AuthGuard from './components/AuthGuard'
import BottomNav from './components/BottomNav'
import Login from './pages/Login'
import ScriptStatus from './pages/ScriptStatus'
import Stocks from './pages/Stocks'
import Dashboard from './pages/Dashboard'
import Audit from './pages/Audit'
import Settings from './pages/Settings'
import PaytmMoneyCallback from './pages/PaytmMoneyCallback'
import LiveTicks from './pages/LiveTicks'

const isDryRun = new URLSearchParams(window.location.search).has('dryRun')

function App() {
  if (isDryRun) {
    return <LiveTicks />
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/paytm-money-callback" element={<PaytmMoneyCallback />} />
        <Route path="/" element={<AuthGuard><LiveTicks /></AuthGuard>} />
        <Route path="/scripts" element={<AuthGuard><ScriptStatus /></AuthGuard>} />
        <Route path="/stocks" element={<AuthGuard><Stocks /></AuthGuard>} />
        <Route path="/dashboard" element={<AuthGuard><Dashboard /></AuthGuard>} />
        <Route path="/audit" element={<AuthGuard><Audit /></AuthGuard>} />
        <Route path="/settings" element={<AuthGuard><Settings /></AuthGuard>} />
      </Routes>
      <BottomNav />
    </BrowserRouter>
  )
}

export default App

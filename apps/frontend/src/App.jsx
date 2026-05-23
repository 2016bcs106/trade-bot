import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AuthGuard from './components/AuthGuard'
import BottomNav from './components/BottomNav'
import Login from './pages/Login'
import Home from './pages/Home'
import ScriptStatus from './pages/ScriptStatus'
import Stocks from './pages/Stocks'
import PaytmMoneyCallback from './pages/PaytmMoneyCallback'

const isDryRun = new URLSearchParams(window.location.search).has('dryRun')

function App() {
  if (isDryRun) {
    return <Home />
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/paytm-money-callback" element={<PaytmMoneyCallback />} />
        <Route path="/" element={<AuthGuard><Home /></AuthGuard>} />
        <Route path="/scripts" element={<AuthGuard><ScriptStatus /></AuthGuard>} />
        <Route path="/stocks" element={<AuthGuard><Stocks /></AuthGuard>} />
      </Routes>
      <BottomNav />
    </BrowserRouter>
  )
}

export default App

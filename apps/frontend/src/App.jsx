import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AuthGuard from './components/AuthGuard'
import Login from './pages/Login'
import Home from './pages/Home'
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
      </Routes>
    </BrowserRouter>
  )
}

export default App

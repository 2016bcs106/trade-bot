import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faListUl, faHeartPulse, faGear } from '@fortawesome/free-solid-svg-icons'
import moment from 'moment'
import { useApp } from '../context/AppContext'

const navItems = [
  { path: '/', label: 'Stocks', icon: faListUl },
  { path: '/monitor', label: 'Monitor', icon: faHeartPulse },
  { path: '/settings', label: 'Settings', icon: faGear },
]

const hiddenPaths = ['/login', '/paytm-money-callback']

function MinuteProgressBar() {
  const { marketStatus } = useApp()
  const [seconds, setSeconds] = useState(moment().seconds())

  useEffect(() => {
    const interval = setInterval(() => setSeconds(moment().seconds()), 1000)
    return () => clearInterval(interval)
  }, [])

  if (marketStatus === 'Closed') return null

  const progress = (seconds / 60) * 100

  return (
    <div style={styles.progressTrack}>
      <div style={{ ...styles.progressFill, width: `${progress}%` }} />
    </div>
  )
}

export default function BottomNav() {
  const navigate = useNavigate()
  const location = useLocation()

  if (hiddenPaths.includes(location.pathname)) return null

  return (
    <nav style={styles.nav}>
      <MinuteProgressBar />
      {navItems.map((item) => {
        const isActive = item.path === '/'
          ? (location.pathname === '/' || location.pathname.startsWith('/live/'))
          : location.pathname === item.path
        const color = isActive ? 'var(--color-primary)' : 'var(--color-text-muted)'
        return (
          <button key={item.path} onClick={() => navigate(item.path)} style={styles.item}>
            <FontAwesomeIcon icon={item.icon} style={{ fontSize: '1.25rem', color }} />
            <span style={{ ...styles.label, color }}>{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

const styles = {
  nav: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    display: 'flex',
    justifyContent: 'space-around',
    alignItems: 'center',
    background: 'rgba(249, 249, 249, 0.94)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    borderTop: '0.5px solid var(--color-separator)',
    paddingTop: '8px',
    paddingBottom: 'max(8px, env(safe-area-inset-bottom))',
    zIndex: 1000,
  },
  item: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '3px',
    padding: '0',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    minWidth: '64px',
  },
  label: {
    fontSize: '10px',
    fontWeight: 500,
  },
  progressTrack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '2px',
    background: 'var(--color-border)',
  },
  progressFill: {
    height: '100%',
    background: 'var(--color-primary)',
    transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    borderRadius: '0 1px 1px 0',
  },
}

import { useNavigate, useLocation } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChartLine, faListUl, faHeartPulse, faGear } from '@fortawesome/free-solid-svg-icons'

const navItems = [
  { path: '/', label: 'Live', icon: faChartLine },
  { path: '/stocks', label: 'Stocks', icon: faListUl },
  { path: '/monitor', label: 'Monitor', icon: faHeartPulse },
  { path: '/settings', label: 'Settings', icon: faGear },
]

const hiddenPaths = ['/login', '/paytm-money-callback']

export default function BottomNav() {
  const navigate = useNavigate()
  const location = useLocation()

  if (hiddenPaths.includes(location.pathname)) return null

  return (
    <nav style={styles.nav}>
      {navItems.map((item) => {
        const isActive = location.pathname === item.path
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
}

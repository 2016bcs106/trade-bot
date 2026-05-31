import { useNavigate, useLocation } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChartLine, faChartBar, faHeartPulse, faGear } from '@fortawesome/free-solid-svg-icons'

const navItems = [
  { path: '/', label: 'Home', icon: faChartLine },
  { path: '/stocks', label: 'Stocks', icon: faChartBar },
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
        return (
          <button key={item.path} onClick={() => navigate(item.path)} style={{ ...styles.item, ...(isActive ? styles.itemActive : {}) }}>
            <FontAwesomeIcon icon={item.icon} style={{ ...styles.icon, ...(isActive ? styles.iconActive : {}) }} />
            <span style={{ ...styles.label, ...(isActive ? styles.labelActive : {}) }}>{item.label}</span>
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
    background: 'var(--color-card)',
    borderTop: '1px solid var(--color-border)',
    boxShadow: 'var(--shadow-sm)',
    padding: '0.6rem 0',
    zIndex: 1000,
  },
  item: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 'var(--space-xs)',
    padding: '0.4rem 1.5rem',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    border: 'none',
    background: 'transparent',
    transition: 'background 0.2s',
  },
  itemActive: {
    background: 'var(--color-primary-light)',
  },
  icon: {
    fontSize: 'var(--font-xl)',
    color: 'var(--color-text-muted)',
  },
  iconActive: {
    color: 'var(--color-primary)',
  },
  label: {
    fontSize: 'var(--font-xs)',
    fontWeight: 600,
    color: 'var(--color-text-muted)',
  },
  labelActive: {
    color: 'var(--color-primary)',
  },
}

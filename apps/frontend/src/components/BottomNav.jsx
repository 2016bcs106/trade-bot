import { useNavigate, useLocation } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChartLine, faServer, faChartBar } from '@fortawesome/free-solid-svg-icons'

const navItems = [
  { path: '/', label: 'Home', icon: faChartLine },
  { path: '/stocks', label: 'Stocks', icon: faChartBar },
  { path: '/scripts', label: 'Scripts', icon: faServer },
]

const hiddenPaths = ['/login', '/paytm-money-callback']

const styles = {
  nav: {
    position: 'fixed',
    bottom: '0',
    left: '0',
    right: '0',
    display: 'flex',
    justifyContent: 'space-around',
    alignItems: 'center',
    background: 'var(--pm-card-bg)',
    borderTop: '1px solid var(--pm-border)',
    boxShadow: '0 -2px 8px rgba(0, 0, 0, 0.06)',
    padding: '0.6rem 0',
    zIndex: 1000,
  },
  item: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.25rem',
    padding: '0.4rem 1.5rem',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'background 0.2s',
    border: 'none',
    background: 'transparent',
  },
  itemActive: {
    background: 'rgba(59, 130, 246, 0.1)',
  },
  icon: {
    fontSize: '1.1rem',
    color: 'var(--pm-text-muted)',
  },
  iconActive: {
    color: 'var(--pm-primary)',
  },
  label: {
    fontSize: '0.65rem',
    fontWeight: '600',
    color: 'var(--pm-text-muted)',
  },
  labelActive: {
    color: 'var(--pm-primary)',
  },
}

export default function BottomNav() {
  const navigate = useNavigate()
  const location = useLocation()

  if (hiddenPaths.includes(location.pathname)) {
    return null
  }

  return (
    <nav style={styles.nav}>
      {navItems.map((item) => {
        const isActive = location.pathname === item.path
        return (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            style={{
              ...styles.item,
              ...(isActive ? styles.itemActive : {}),
            }}
          >
            <FontAwesomeIcon
              icon={item.icon}
              style={{
                ...styles.icon,
                ...(isActive ? styles.iconActive : {}),
              }}
            />
            <span style={{
              ...styles.label,
              ...(isActive ? styles.labelActive : {}),
            }}>
              {item.label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}

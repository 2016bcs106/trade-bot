import { useApp } from '../context/AppContext'

export default function StatusBadges() {
  const { status, marketStatus } = useApp()
  const online = status === 'connected'
  const marketOpen = marketStatus !== 'Closed'

  return (
    <div style={styles.badges}>
      <span style={{ ...styles.badge, color: online ? '#34c759' : '#ff3b30', background: online ? 'rgba(52,199,89,0.12)' : 'rgba(255,59,48,0.12)' }}>
        <span style={{ ...styles.dot, background: online ? '#34c759' : '#ff3b30' }} />
        {online ? 'Online' : 'Offline'}
      </span>
      <span style={{ ...styles.badge, color: marketOpen ? '#34c759' : '#8e8e93', background: marketOpen ? 'rgba(52,199,89,0.12)' : 'rgba(142,142,147,0.12)' }}>
        <span style={{ ...styles.dot, background: marketOpen ? '#34c759' : '#8e8e93' }} />
        {marketOpen ? 'Market Open' : 'Market Closed'}
      </span>
    </div>
  )
}

const styles = {
  badges: {
    display: 'flex',
    gap: '6px',
  },
  badge: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '10px',
    fontWeight: 600,
    padding: '3px 8px',
    borderRadius: '100px',
    whiteSpace: 'nowrap',
  },
  dot: {
    width: '5px',
    height: '5px',
    borderRadius: '50%',
    flexShrink: 0,
  },
}

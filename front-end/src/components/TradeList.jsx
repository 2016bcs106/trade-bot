import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleCheck, faCircleXmark } from '@fortawesome/free-regular-svg-icons'
import { faSpinner, faCircleMinus } from '@fortawesome/free-solid-svg-icons'
import { colors, gainColor, merge } from '../utils/styles'

const STATUS_CONFIG = {
  'success': { icon: faCircleCheck, color: colors.green },
  'pending': { icon: faSpinner, color: colors.amber },
  'failed': { icon: faCircleXmark, color: colors.red },
  'dry-run': { icon: faCircleMinus, color: colors.muted },
}

const styles = {
  container: {
    flex: 1,
    overflowY: 'auto',
    padding: 0,
  },
  title: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: colors.secondary,
    padding: '0.5rem 0.5rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  card: {
    display: 'flex',
    alignItems: 'center',
    padding: '0.75rem 1rem',
    background: colors.white,
    borderRadius: 0,
    marginBottom: 0,
    borderBottom: `1px solid ${colors.light}`,
    gap: '0.75rem',
  },
  badgeCol: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.25rem',
    width: '40px',
    flexShrink: 0,
  },
  badge: {
    fontSize: '0.5625rem',
    fontWeight: '700',
    letterSpacing: '0.05em',
    padding: '0.15rem 0.375rem',
    borderRadius: '4px',
    background: 'transparent',
    textAlign: 'center',
    width: '36px',
    boxSizing: 'border-box',
  },
  time: {
    fontSize: '0.625rem',
    color: colors.muted,
  },
  price: {
    fontSize: '0.9375rem',
    fontWeight: '600',
    color: colors.dark,
  },
  gain: {
    fontSize: '0.8125rem',
    fontWeight: '600',
    textAlign: 'right',
  },
  status: {
    fontSize: '1rem',
    marginLeft: '0.25rem',
  },
  empty: {
    textAlign: 'center',
    color: colors.muted,
    fontSize: '0.875rem',
    padding: '2rem',
  },
}

export default function TradeList({ signals = [] }) {
  if (signals.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.title}>Trades</div>
        <div style={styles.empty}>No trades yet</div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <div style={styles.title}>Trades</div>
      {[...signals].reverse().map((s, i) => {
        const color = s.signal === 'BUY' ? colors.green : colors.red
        const statusCfg = STATUS_CONFIG[s.status] || STATUS_CONFIG['dry-run']
        return (
          <div key={i} style={styles.card}>
            <div style={styles.badgeCol}>
              <div style={merge(styles.badge, { color, border: `1.5px solid ${color}` })}>
                {s.signal}
              </div>
              <div style={styles.time}>{s.time}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={styles.price}>₹{s.triggerPrice?.toFixed(2) ?? '—'}</div>
            </div>
            <div style={merge(styles.gain, { color: gainColor(s.gain) })}>
              {s.gain !== undefined
                ? `${s.gain >= 0 ? '+' : ''}${s.gain.toFixed(2)}`
                : '—'}
            </div>
            <div style={merge(styles.status, { color: statusCfg.color })} title={s.status}>
              <FontAwesomeIcon
                icon={statusCfg.icon}
                spin={s.status === 'pending'}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

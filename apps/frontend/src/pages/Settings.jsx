import { useState } from 'react'
import moment from 'moment'
import { db, ref, push } from '../utils/firebase'
import { layout, colors } from '../utils/styles'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faRotate, faRocket, faServer, faCog, faCheck } from '@fortawesome/free-solid-svg-icons'

const styles = {
  container: { padding: '1.5rem 1rem', paddingBottom: '6rem' },
  header: { fontSize: '1.2rem', fontWeight: '700', color: 'var(--pm-text)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' },
  section: { marginBottom: '1.5rem' },
  sectionTitle: { fontSize: '0.65rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', color: colors.muted, marginBottom: '0.5rem' },
  card: {
    background: 'var(--pm-card-bg)',
    borderRadius: '10px',
    border: '1px solid var(--pm-border)',
    overflow: 'hidden',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.85rem 1rem',
    borderBottom: '1px solid var(--pm-border)',
    cursor: 'pointer',
  },
  itemLast: {
    borderBottom: 'none',
  },
  iconCircle: {
    width: '2rem',
    height: '2rem',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.85rem',
    flexShrink: 0,
  },
  itemContent: { flex: 1, minWidth: 0 },
  itemTitle: { fontSize: '0.85rem', fontWeight: '600', color: 'var(--pm-text)' },
  itemDesc: { fontSize: '0.7rem', color: colors.muted, marginTop: '0.1rem' },
  badge: {
    fontSize: '0.6rem',
    fontWeight: '700',
    padding: '0.15rem 0.4rem',
    borderRadius: '4px',
    background: 'rgba(148, 163, 184, 0.15)',
    color: colors.muted,
    letterSpacing: '0.03em',
  },
}

function SettingItem({ icon, iconBg, title, desc, badge, isLast, onClick }) {
  return (
    <div style={{ ...styles.item, ...(isLast ? styles.itemLast : {}) }} onClick={onClick}>
      <div style={{ ...styles.iconCircle, background: iconBg }}>
        <FontAwesomeIcon icon={icon} style={{ color: '#fff' }} />
      </div>
      <div style={styles.itemContent}>
        <div style={styles.itemTitle}>{title}</div>
        {desc && <div style={styles.itemDesc}>{desc}</div>}
      </div>
      {badge && <span style={styles.badge}>{badge}</span>}
    </div>
  )
}

export default function Settings() {
  const [updateQueued, setUpdateQueued] = useState(false)

  const handleForceReload = () => {
    window.location.reload(true)
  }

  const handleSystemUpdate = async () => {
    await push(ref(db, 'request_queue'), {
      type: 'system_update',
      payload: {},
      status: 'pending',
      createdAt: moment().utcOffset('+05:30').toISOString(),
    })
    setUpdateQueued(true)
    setTimeout(() => setUpdateQueued(false), 3000)
  }

  return (
    <div style={layout.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <FontAwesomeIcon icon={faCog} /> Settings
        </div>

        {/* App section */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>App</div>
          <div style={styles.card}>
            <SettingItem
              icon={faRotate}
              iconBg="#3b82f6"
              title="Force Reload"
              desc="Clear cache and reload the page"
              onClick={handleForceReload}
              isLast
            />
          </div>
        </div>

        {/* Deploy section */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Deploy</div>
          <div style={styles.card}>
            <SettingItem
              icon={updateQueued ? faCheck : faServer}
              iconBg={updateQueued ? '#22c55e' : '#8b5cf6'}
              title="System Update"
              desc={updateQueued ? 'Update queued! Worker will pull, deploy & restart.' : 'Pull latest code, deploy frontend, restart backend'}
              badge={updateQueued ? 'QUEUED' : undefined}
              onClick={!updateQueued ? handleSystemUpdate : undefined}
              isLast
            />
          </div>
        </div>
      </div>
    </div>
  )
}

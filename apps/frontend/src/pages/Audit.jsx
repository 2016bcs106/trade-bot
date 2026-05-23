import { useState, useEffect } from 'react'
import { ref, onValue, query, orderByChild, limitToLast } from 'firebase/database'
import { db } from '../utils/firebase'

const styles = {
  container: { padding: '1rem', paddingBottom: '5rem' },
  header: { fontSize: '1.3rem', fontWeight: '700', marginBottom: '1rem', color: 'var(--pm-text)' },
  filterRow: {
    display: 'flex',
    gap: '0.5rem',
    marginBottom: '1rem',
    overflowX: 'auto',
    paddingBottom: '0.25rem',
  },
  filterBtn: {
    padding: '0.35rem 0.75rem',
    borderRadius: '16px',
    border: '1px solid var(--pm-border)',
    background: 'var(--pm-card-bg)',
    fontSize: '0.65rem',
    fontWeight: '600',
    color: 'var(--pm-text-muted)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  filterBtnActive: {
    background: 'rgba(59, 130, 246, 0.15)',
    color: '#3b82f6',
    borderColor: '#3b82f6',
  },
  timeline: { position: 'relative', paddingLeft: '1.5rem' },
  timelineLine: {
    position: 'absolute',
    left: '0.4rem',
    top: '0',
    bottom: '0',
    width: '2px',
    background: 'var(--pm-border)',
  },
  event: {
    position: 'relative',
    marginBottom: '0.75rem',
    padding: '0.75rem',
    background: 'var(--pm-card-bg)',
    borderRadius: '10px',
    border: '1px solid var(--pm-border)',
  },
  eventDot: {
    position: 'absolute',
    left: '-1.25rem',
    top: '1rem',
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: '#3b82f6',
  },
  eventType: { fontSize: '0.7rem', fontWeight: '700', color: 'var(--pm-text)', marginBottom: '0.2rem' },
  eventDesc: { fontSize: '0.7rem', color: 'var(--pm-text-muted)', marginBottom: '0.3rem' },
  eventMeta: { fontSize: '0.6rem', color: 'var(--pm-text-muted)' },
  empty: { textAlign: 'center', padding: '2rem', color: 'var(--pm-text-muted)', fontSize: '0.85rem' },
}

const EVENT_FILTERS = ['all', 'stock', 'training', 'model', 'prediction', 'evaluation', 'system']

function getEventColor(type) {
  if (type?.startsWith('stock')) return '#22c55e'
  if (type?.startsWith('training')) return '#eab308'
  if (type?.startsWith('model')) return '#8b5cf6'
  if (type?.startsWith('prediction')) return '#3b82f6'
  if (type?.startsWith('evaluation')) return '#f97316'
  return '#6b7280'
}

export default function Audit() {
  const [events, setEvents] = useState([])
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    const auditRef = query(ref(db, 'audit'), orderByChild('timestamp'), limitToLast(100))
    const unsub = onValue(auditRef, (snap) => {
      const data = snap.val()
      if (!data) { setEvents([]); return }

      const list = Object.values(data)
        .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
      setEvents(list)
    })
    return () => unsub()
  }, [])

  const filteredEvents = filter === 'all'
    ? events
    : events.filter((e) => e.type?.startsWith(filter))

  return (
    <div style={styles.container}>

      {/* Filter tabs */}
      <div style={styles.filterRow}>
        {EVENT_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              ...styles.filterBtn,
              ...(filter === f ? styles.filterBtnActive : {}),
            }}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Timeline */}
      {filteredEvents.length === 0 ? (
        <div style={styles.empty}>No audit events recorded yet</div>
      ) : (
        <div style={styles.timeline}>
          <div style={styles.timelineLine} />
          {filteredEvents.map((event, i) => (
            <div key={event.id || i} style={styles.event}>
              <div style={{ ...styles.eventDot, background: getEventColor(event.type) }} />
              <div style={styles.eventType}>
                {event.type?.replace('.', ' › ')}
                {event.symbol && (
                  <span style={{ fontWeight: '400', marginLeft: '0.5rem' }}>
                    [{event.symbol}]
                  </span>
                )}
              </div>
              <div style={styles.eventDesc}>{event.description}</div>
              <div style={styles.eventMeta}>{event.timestamp}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

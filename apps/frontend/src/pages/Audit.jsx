import { useState, useEffect } from 'react'
import moment from 'moment'
import { ref, onValue, query, orderByChild, limitToLast } from 'firebase/database'
import { db } from '../utils/firebase'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircle, faChevronDown, faChevronRight } from '@fortawesome/free-solid-svg-icons'

const statusColors = {
  running: '#22c55e',
  stopped: '#94a3b8',
  errored: '#ef4444',
}

const styles = {
  container: { padding: '1rem', paddingBottom: '5rem' },
  sectionTitle: {
    fontSize: '0.8rem',
    fontWeight: '700',
    color: 'var(--pm-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '0.5rem',
    marginTop: '0.75rem',
  },
  card: {
    background: 'var(--pm-card-bg)',
    borderRadius: '12px',
    border: '1px solid var(--pm-border)',
    padding: '0.75rem 1rem',
    marginBottom: '0.5rem',
  },
  // Script Status styles
  scriptRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  scriptName: { fontSize: '0.8rem', fontWeight: '600', color: 'var(--pm-text)' },
  statusBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.3rem',
    fontSize: '0.65rem',
    fontWeight: '600',
    padding: '0.15rem 0.5rem',
    borderRadius: '10px',
  },
  statusDot: { fontSize: '0.4rem' },
  scriptMeta: { fontSize: '0.65rem', color: 'var(--pm-text-muted)', marginTop: '0.2rem' },
  // Collapsible
  collapsibleBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    padding: '0.3rem 0',
    cursor: 'pointer',
    border: 'none',
    background: 'none',
    width: '100%',
    textAlign: 'left',
    fontSize: '0.7rem',
    color: 'var(--pm-text-muted)',
    fontWeight: '500',
  },
  jsonBlock: {
    fontSize: '0.65rem',
    fontFamily: 'monospace',
    background: 'var(--pm-bg)',
    border: '1px solid var(--pm-border)',
    borderRadius: '6px',
    padding: '0.5rem 0.6rem',
    marginTop: '0.25rem',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    color: 'var(--pm-text)',
    overflowX: 'auto',
  },
  // Audit timeline styles
  event: {
    background: 'var(--pm-card-bg)',
    borderRadius: '10px',
    border: '1px solid var(--pm-border)',
    padding: '0.6rem 0.75rem',
    marginBottom: '0.5rem',
  },
  eventType: { fontSize: '0.7rem', fontWeight: '700', color: 'var(--pm-text)', marginBottom: '0.15rem' },
  eventDesc: { fontSize: '0.65rem', color: 'var(--pm-text-muted)', marginBottom: '0.2rem' },
  eventMeta: { fontSize: '0.6rem', color: 'var(--pm-text-muted)' },
  empty: { textAlign: 'center', padding: '1.5rem', color: 'var(--pm-text-muted)', fontSize: '0.8rem' },
}

function getRelativeTime(value) {
  if (!value) return '—'
  const m = moment(value)
  if (!m.isValid()) return '—'
  return m.fromNow()
}

function CollapsibleJson({ label, data }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div>
      <button onClick={() => setExpanded(!expanded)} style={styles.collapsibleBtn}>
        <FontAwesomeIcon
          icon={expanded ? faChevronDown : faChevronRight}
          style={{ fontSize: '0.55rem', width: '0.55rem' }}
        />
        {label}
      </button>
      {expanded && (
        <pre style={styles.jsonBlock}>{JSON.stringify(data, null, 2)}</pre>
      )}
    </div>
  )
}

function ScriptStatusSection({ scripts }) {
  if (!scripts || Object.keys(scripts).length === 0) {
    return <div style={styles.empty}>No scripts reporting</div>
  }

  return Object.entries(scripts).map(([name, data]) => {
    const status = data.status || 'stopped'
    const color = statusColors[status] || statusColors.stopped

    return (
      <div key={name} style={styles.card}>
        <div style={styles.scriptRow}>
          <span style={styles.scriptName}>{name}</span>
          <span style={{ ...styles.statusBadge, background: `${color}15`, color }}>
            <FontAwesomeIcon icon={faCircle} style={styles.statusDot} />
            {status}
          </span>
        </div>
        <div style={styles.scriptMeta}>
          Heartbeat: {getRelativeTime(data.lastHeartbeat)}
        </div>
        {data.metadata && (
          <CollapsibleJson label="Details" data={data.metadata} />
        )}
        {data.error && (
          <div style={{ fontSize: '0.65rem', color: '#ef4444', marginTop: '0.25rem' }}>
            ⚠ {data.error}
          </div>
        )}
      </div>
    )
  })
}

export default function Audit() {
  const [scripts, setScripts] = useState(null)
  const [events, setEvents] = useState([])

  useEffect(() => {
    const scriptsRef = ref(db, 'scripts')
    const unsubScripts = onValue(scriptsRef, (snap) => {
      setScripts(snap.val())
    })

    const auditRef = query(ref(db, 'audit'), orderByChild('timestamp'), limitToLast(100))
    const unsubAudit = onValue(auditRef, (snap) => {
      const data = snap.val()
      if (!data) { setEvents([]); return }
      const list = Object.values(data)
        .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
      setEvents(list)
    })

    return () => { unsubScripts(); unsubAudit() }
  }, [])

  return (
    <div style={styles.container}>
      {/* Script Status Section */}
      <div style={styles.sectionTitle}>Script Status</div>
      <ScriptStatusSection scripts={scripts} />

      {/* Audit Section */}
      <div style={{ ...styles.sectionTitle, marginTop: '1.25rem' }}>Audit Log</div>
      {events.length === 0 ? (
        <div style={styles.empty}>No audit events recorded yet</div>
      ) : (
        events.map((event, i) => (
          <div key={event.id || i} style={styles.event}>
            <div style={styles.eventType}>
              {event.type?.replace('.', ' › ')}
              {event.symbol && <span style={{ fontWeight: '400' }}> [{event.symbol}]</span>}
            </div>
            {event.description && <div style={styles.eventDesc}>{event.description}</div>}
            <div style={styles.eventMeta}>{event.timestamp}</div>
          </div>
        ))
      )}
    </div>
  )
}

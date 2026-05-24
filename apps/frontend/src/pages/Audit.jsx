import { useState, useEffect } from 'react'
import moment from 'moment'
import { ref, onValue, remove, query, orderByChild, limitToLast } from 'firebase/database'
import { db } from '../utils/firebase'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircle, faChevronDown, faChevronRight, faTrash } from '@fortawesome/free-solid-svg-icons'

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

const requestStatusColors = {
  pending: { bg: 'rgba(245, 158, 11, 0.12)', color: '#f59e0b' },
  processing: { bg: 'rgba(59, 130, 246, 0.12)', color: '#3b82f6' },
  completed: { bg: 'rgba(34, 197, 94, 0.12)', color: '#22c55e' },
  failed: { bg: 'rgba(239, 68, 68, 0.12)', color: '#ef4444' },
}

function RequestsSection({ requests, failed, onDeleteFailed }) {
  const allRequests = [
    ...requests.map(r => ({ ...r, _source: 'queue' })),
    ...failed.map(r => ({ ...r, _source: 'failed' })),
  ].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))

  if (allRequests.length === 0) {
    return <div style={styles.empty}>No requests in queue</div>
  }

  return allRequests.map((req) => {
    const statusStyle = requestStatusColors[req.status] || requestStatusColors.pending
    return (
      <div key={req._key} style={styles.card}>
        <div style={styles.scriptRow}>
          <span style={styles.scriptName}>{req.type}</span>
          <span style={{ ...styles.statusBadge, background: statusStyle.bg, color: statusStyle.color }}>
            <FontAwesomeIcon icon={faCircle} style={styles.statusDot} />
            {req.status}
          </span>
        </div>
        <div style={styles.scriptMeta}>
          {getRelativeTime(req.createdAt)}
          {req.payload && Object.keys(req.payload).length > 0 && (
            <span> · {Object.entries(req.payload).map(([k, v]) => `${k}: ${v}`).join(', ')}</span>
          )}
        </div>
        {req.error && (
          <div style={{ fontSize: '0.65rem', color: '#ef4444', marginTop: '0.25rem' }}>
            ⚠ {req.error}
          </div>
        )}
        {req._source === 'failed' && (
          <button
            onClick={() => onDeleteFailed(req._key)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.65rem', color: '#ef4444', marginTop: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
          >
            <FontAwesomeIcon icon={faTrash} /> Delete
          </button>
        )}
      </div>
    )
  })
}

export default function Audit() {
  const [scripts, setScripts] = useState(null)
  const [events, setEvents] = useState([])
  const [requests, setRequests] = useState([])
  const [failedRequests, setFailedRequests] = useState([])

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

    const queueRef = ref(db, 'request_queue')
    const unsubQueue = onValue(queueRef, (snap) => {
      const data = snap.val()
      if (!data) { setRequests([]); return }
      setRequests(Object.entries(data).map(([key, val]) => ({ ...val, _key: key })))
    })

    const failedRef = ref(db, 'failed_requests')
    const unsubFailed = onValue(failedRef, (snap) => {
      const data = snap.val()
      if (!data) { setFailedRequests([]); return }
      setFailedRequests(Object.entries(data).map(([key, val]) => ({ ...val, _key: key })))
    })

    return () => { unsubScripts(); unsubAudit(); unsubQueue(); unsubFailed() }
  }, [])

  const handleDeleteFailed = async (key) => {
    await remove(ref(db, `failed_requests/${key}`))
  }

  return (
    <div style={styles.container}>
      {/* Script Status Section */}
      <div style={styles.sectionTitle}>Script Status</div>
      <ScriptStatusSection scripts={scripts} />

      {/* Requests Section */}
      <div style={{ ...styles.sectionTitle, marginTop: '1.25rem' }}>Requests</div>
      <RequestsSection
        requests={requests}
        failed={failedRequests}
        onDeleteFailed={handleDeleteFailed}
      />

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

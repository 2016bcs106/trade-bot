import { useState, useEffect } from 'react'
import { db, ref, onValue } from '../utils/firebase'
import { layout, text, card } from '../utils/styles'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircle, faServer, faClock, faExclamationTriangle, faChevronDown, faChevronRight } from '@fortawesome/free-solid-svg-icons'

const statusColors = {
  running: '#22c55e',
  stopped: '#94a3b8',
  errored: '#ef4444',
}

const styles = {
  container: {
    padding: '1rem',
    paddingBottom: '5rem', // space for bottom nav
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  scriptCard: {
    ...card.base,
    padding: '1rem 1.25rem',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '0.75rem',
  },
  scriptName: {
    fontSize: '0.95rem',
    fontWeight: '600',
    color: 'var(--pm-text)',
  },
  statusBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    fontSize: '0.75rem',
    fontWeight: '600',
    padding: '0.2rem 0.6rem',
    borderRadius: '12px',
  },
  statusDot: {
    fontSize: '0.5rem',
  },
  metaRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    padding: '0.3rem 0',
    gap: '1rem',
  },
  metaLabel: {
    fontSize: '0.75rem',
    color: 'var(--pm-text-muted)',
    flexShrink: 0,
  },
  metaValue: {
    fontSize: '0.75rem',
    fontWeight: '500',
    color: 'var(--pm-text)',
    textAlign: 'right',
    wordBreak: 'break-all',
  },
  collapsibleHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    padding: '0.3rem 0',
    cursor: 'pointer',
    border: 'none',
    background: 'none',
    width: '100%',
    textAlign: 'left',
  },
  jsonBlock: {
    fontSize: '0.7rem',
    fontFamily: 'monospace',
    background: 'var(--pm-bg)',
    border: '1px solid var(--pm-border)',
    borderRadius: '6px',
    padding: '0.6rem 0.75rem',
    marginTop: '0.25rem',
    marginBottom: '0.25rem',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    color: 'var(--pm-text)',
    overflowX: 'auto',
  },
  errorBox: {
    marginTop: '0.5rem',
    padding: '0.5rem 0.75rem',
    borderRadius: '8px',
    background: 'rgba(239, 68, 68, 0.08)',
    border: '1px solid rgba(239, 68, 68, 0.2)',
  },
  errorText: {
    fontSize: '0.75rem',
    color: '#ef4444',
    wordBreak: 'break-word',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '3rem 1rem',
    gap: '0.75rem',
  },
}

function formatTimestamp(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true })
}

function getRelativeTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (isNaN(date.getTime())) return '—'
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 0) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

function CollapsibleJson({ label, value }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        style={styles.collapsibleHeader}
      >
        <FontAwesomeIcon
          icon={expanded ? faChevronDown : faChevronRight}
          style={{ fontSize: '0.6rem', color: 'var(--pm-text-muted)', width: '0.6rem' }}
        />
        <span style={styles.metaLabel}>{label}</span>
      </button>
      {expanded && (
        <pre style={styles.jsonBlock}>
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  )
}

function ScriptCard({ name, data }) {
  const status = data.status || 'stopped'
  const color = statusColors[status] || statusColors.stopped

  return (
    <div style={styles.scriptCard}>
      <div style={styles.cardHeader}>
        <span style={styles.scriptName}>{name}</span>
        <span style={{
          ...styles.statusBadge,
          background: `${color}15`,
          color: color,
        }}>
          <FontAwesomeIcon icon={faCircle} style={styles.statusDot} />
          {status}
        </span>
      </div>

      <div style={styles.metaRow}>
        <span style={styles.metaLabel}>
          <FontAwesomeIcon icon={faClock} style={{ marginRight: '0.3rem' }} />
          Last Heartbeat
        </span>
        <span style={styles.metaValue}>{getRelativeTime(data.lastHeartbeat)}</span>
      </div>

      <div style={styles.metaRow}>
        <span style={styles.metaLabel}>Started At</span>
        <span style={styles.metaValue}>{formatTimestamp(data.startedAt)}</span>
      </div>

      {data.metadata && Object.entries(data.metadata).map(([key, value]) => (
        typeof value === 'object' && value !== null ? (
          <CollapsibleJson key={key} label={key} value={value} />
        ) : (
          <div key={key} style={styles.metaRow}>
            <span style={styles.metaLabel}>{key}</span>
            <span style={styles.metaValue}>{String(value)}</span>
          </div>
        )
      ))}

      {data.error && (
        <div style={styles.errorBox}>
          <FontAwesomeIcon icon={faExclamationTriangle} style={{ color: '#ef4444', marginRight: '0.4rem', fontSize: '0.7rem' }} />
          <span style={styles.errorText}>{data.error}</span>
        </div>
      )}
    </div>
  )
}

export default function ScriptStatus() {
  const [scripts, setScripts] = useState(null)

  useEffect(() => {
    const scriptsRef = ref(db, 'scripts')
    const unsubscribe = onValue(scriptsRef, (snapshot) => {
      setScripts(snapshot.val())
    })
    return () => unsubscribe()
  }, [])

  return (
    <div style={layout.page}>

      <div style={styles.container}>
        {!scripts ? (
          <div style={styles.emptyState}>
            <FontAwesomeIcon icon={faServer} style={{ fontSize: '2rem', color: 'var(--pm-text-muted)' }} />
            <span style={text.muted}>No scripts reporting yet</span>
          </div>
        ) : (
          Object.entries(scripts).map(([name, data]) => (
            <ScriptCard key={name} name={name} data={data} />
          ))
        )}
      </div>
    </div>
  )
}

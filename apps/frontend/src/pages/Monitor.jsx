import { useState, useEffect } from 'react'
import moment from 'moment'
import { ref, onValue, remove } from 'firebase/database'
import { db } from '../utils/firebase'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircle, faChevronDown, faChevronRight, faTrash, faHeartPulse } from '@fortawesome/free-solid-svg-icons'
import Loader from '../components/Loader'
import Page from '../components/Page'
import PageHeader from '../components/PageHeader'
import SectionHeader from '../components/SectionHeader'
import Card from '../components/Card'
import Badge from '../components/Badge'

const STATUS_COLORS = {
  running: 'var(--color-success)',
  stopped: 'var(--color-text-muted)',
  errored: 'var(--color-danger)',
}

const REQUEST_STATUS = {
  pending: { color: 'var(--color-warning)' },
  processing: { color: 'var(--color-info)' },
  completed: { color: 'var(--color-success)' },
  failed: { color: 'var(--color-danger)' },
}

function CollapsibleJson({ label, data }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div>
      <button onClick={() => setExpanded(!expanded)} style={styles.collapsibleBtn}>
        <FontAwesomeIcon icon={expanded ? faChevronDown : faChevronRight} style={{ fontSize: '0.55rem' }} />
        {label}
      </button>
      {expanded && (
        <pre style={styles.jsonBlock}>{JSON.stringify(data, null, 2)}</pre>
      )}
    </div>
  )
}

function ScriptCard({ name, data }) {
  const status = data.status || 'stopped'
  const color = STATUS_COLORS[status] || STATUS_COLORS.stopped

  return (
    <Card>
      <div style={styles.row}>
        <span style={styles.name}>{name}</span>
        <Badge label={status} color={color} />
      </div>
      <div style={styles.meta}>
        Heartbeat: {data.lastHeartbeat ? moment(data.lastHeartbeat).fromNow() : '—'}
      </div>
      {data.metadata && <CollapsibleJson label="Details" data={data.metadata} />}
      {data.error && <div style={styles.error}>⚠ {data.error}</div>}
    </Card>
  )
}

function RequestCard({ req, onDelete }) {
  const statusStyle = REQUEST_STATUS[req.status] || REQUEST_STATUS.pending

  return (
    <Card>
      <div style={styles.row}>
        <span style={styles.name}>{req.type}</span>
        <Badge label={req.status} color={statusStyle.color} />
      </div>
      <div style={styles.meta}>
        {req.createdAt ? moment(req.createdAt).fromNow() : '—'}
        {req.payload && Object.keys(req.payload).length > 0 && (
          <span> · {Object.entries(req.payload).map(([k, v]) => `${k}: ${v}`).join(', ')}</span>
        )}
      </div>
      {req.error && <div style={styles.error}>⚠ {req.error}</div>}
      {req._source === 'failed' && (
        <button onClick={() => onDelete(req._key)} style={styles.deleteBtn}>
          <FontAwesomeIcon icon={faTrash} /> Delete
        </button>
      )}
    </Card>
  )
}

export default function Monitor() {
  const [scripts, setScripts] = useState(undefined)
  const [requests, setRequests] = useState([])
  const [failedRequests, setFailedRequests] = useState([])

  useEffect(() => {
    const unsubScripts = onValue(ref(db, 'scripts'), (snap) => setScripts(snap.val()))
    const unsubQueue = onValue(ref(db, 'request_queue'), (snap) => {
      const data = snap.val()
      setRequests(data ? Object.entries(data).map(([key, val]) => ({ ...val, _key: key })) : [])
    })
    const unsubFailed = onValue(ref(db, 'failed_requests'), (snap) => {
      const data = snap.val()
      setFailedRequests(data ? Object.entries(data).map(([key, val]) => ({ ...val, _key: key })) : [])
    })

    return () => { unsubScripts(); unsubQueue(); unsubFailed() }
  }, [])

  const allRequests = [
    ...requests.map(r => ({ ...r, _source: 'queue' })),
    ...failedRequests.map(r => ({ ...r, _source: 'failed' })),
  ].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))

  if (scripts === undefined) {
    return <Page><Loader /></Page>
  }

  return (
    <Page>
      <PageHeader icon={faHeartPulse} title="Monitor" />

      <SectionHeader>Scripts</SectionHeader>
      {!scripts || Object.keys(scripts).length === 0 ? (
        <Card><div style={styles.empty}>No scripts reporting</div></Card>
      ) : (
        Object.entries(scripts).map(([name, data]) => (
          <ScriptCard key={name} name={name} data={data} />
        ))
      )}

      <SectionHeader style={{ marginTop: 'var(--space-xl)' }}>Requests</SectionHeader>
      {allRequests.length === 0 ? (
        <Card><div style={styles.empty}>No requests in queue</div></Card>
      ) : (
        allRequests.map((req) => (
          <RequestCard
            key={req._key}
            req={req}
            onDelete={(key) => remove(ref(db, `failed_requests/${key}`))}
          />
        ))
      )}
    </Page>
  )
}

const styles = {
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  name: {
    fontSize: 'var(--font-base)',
    fontWeight: 600,
    color: 'var(--color-text)',
  },
  meta: {
    fontSize: 'var(--font-sm)',
    color: 'var(--color-text-muted)',
    marginTop: 'var(--space-xs)',
  },
  error: {
    fontSize: 'var(--font-sm)',
    color: 'var(--color-danger)',
    marginTop: 'var(--space-xs)',
  },
  empty: {
    textAlign: 'center',
    padding: 'var(--space-lg)',
    color: 'var(--color-text-muted)',
    fontSize: 'var(--font-base)',
  },
  collapsibleBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
    padding: 'var(--space-xs) 0',
    cursor: 'pointer',
    border: 'none',
    background: 'none',
    width: '100%',
    textAlign: 'left',
    fontSize: 'var(--font-sm)',
    color: 'var(--color-text-muted)',
    fontWeight: 500,
  },
  jsonBlock: {
    fontSize: 'var(--font-sm)',
    fontFamily: 'monospace',
    background: 'var(--color-bg)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    padding: 'var(--space-sm) var(--space-md)',
    marginTop: 'var(--space-xs)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    color: 'var(--color-text)',
    overflowX: 'auto',
  },
  deleteBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 'var(--font-sm)',
    color: 'var(--color-danger)',
    marginTop: 'var(--space-sm)',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-xs)',
  },
}

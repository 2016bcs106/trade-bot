import { useState } from 'react'
import moment from 'moment'
import { ref, remove } from 'firebase/database'
import { db } from '../utils/firebase'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircle } from '@fortawesome/free-solid-svg-icons'
import Page from '../components/Page'
import PageHeader from '../components/PageHeader'
import SectionHeader from '../components/SectionHeader'
import Card from '../components/Card'
import Badge from '../components/Badge'
import Loader from '../components/Loader'
import BottomSheet from '../components/BottomSheet'
import { useApp } from '../context/AppContext'

const STATUS_COLORS = {
  running: 'var(--color-success)',
  stopped: 'var(--color-text-muted)',
  errored: 'var(--color-danger)',
}

const REQUEST_COLORS = {
  pending: 'var(--color-warning)',
  processing: 'var(--color-primary)',
  completed: 'var(--color-success)',
  failed: 'var(--color-danger)',
}

function ScriptCard({ name, data, onTap }) {
  const status = data.status || 'stopped'
  const color = STATUS_COLORS[status] || STATUS_COLORS.stopped

  return (
    <Card style={{ cursor: 'pointer' }} onClick={onTap}>
      <div style={styles.row}>
        <div style={{ flex: 1 }}>
          <div style={styles.name}>{name}</div>
          <div style={styles.meta}>{data.lastHeartbeat ? moment(data.lastHeartbeat).fromNow() : '—'}</div>
        </div>
        <Badge label={status} color={color} />
      </div>
      {data.error && <div style={styles.error}>{data.error}</div>}
    </Card>
  )
}

function RequestCard({ req, onTap }) {
  return (
    <Card style={{ cursor: 'pointer' }} onClick={onTap}>
      <div style={styles.row}>
        <div style={{ flex: 1 }}>
          <div style={styles.name}>{req.type}</div>
          <div style={styles.meta}>
            {req.createdAt ? moment(req.createdAt).fromNow() : '—'}
            {req.payload && Object.keys(req.payload).length > 0 && (
              <span> · {Object.entries(req.payload).map(([k, v]) => `${k}: ${v}`).join(', ')}</span>
            )}
          </div>
        </div>
        <Badge label={req.status} color={REQUEST_COLORS[req.status] || REQUEST_COLORS.pending} />
      </div>
      {req.error && <div style={styles.error}>{req.error}</div>}
    </Card>
  )
}

export default function Monitor() {
  const { scripts, requestQueue: requests, failedRequests } = useApp()
  const [sheetData, setSheetData] = useState(null)

  if (scripts === undefined) {
    return <Page><Loader /></Page>
  }

  const allRequests = [
    ...requests.map(r => ({ ...r, _source: 'queue' })),
    ...failedRequests.map(r => ({ ...r, _source: 'failed' })),
  ].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))

  const handleDeleteFailed = async (key) => {
    await remove(ref(db, `failed_requests/${key}`))
    setSheetData(null)
  }

  return (
    <Page>
      <PageHeader title="Monitor" />

      <SectionHeader>Scripts</SectionHeader>
      {!scripts || Object.keys(scripts).length === 0 ? (
        <Card><div style={styles.empty}>No scripts reporting</div></Card>
      ) : (
        Object.entries(scripts).map(([name, data]) => (
          <ScriptCard key={name} name={name} data={data} onTap={() => setSheetData({ title: name, data, type: 'script' })} />
        ))
      )}

      <SectionHeader>Requests</SectionHeader>
      {allRequests.length === 0 ? (
        <Card><div style={styles.empty}>No requests</div></Card>
      ) : (
        allRequests.map((req) => (
          <RequestCard key={req._key} req={req} onTap={() => setSheetData({ title: req.type, data: req, type: 'request' })} />
        ))
      )}

      {/* Detail bottom sheet */}
      <BottomSheet title={sheetData?.title} isOpen={!!sheetData} onClose={() => setSheetData(null)}>
        {sheetData && (
          <div style={styles.sheetBody}>
            <pre style={styles.jsonBlock}>{JSON.stringify(sheetData.data, null, 2)}</pre>
            {sheetData.type === 'request' && sheetData.data._source === 'failed' && (
              <button style={styles.deleteBtn} onClick={() => handleDeleteFailed(sheetData.data._key)}>
                Delete Failed Request
              </button>
            )}
          </div>
        )}
      </BottomSheet>
    </Page>
  )
}

const styles = {
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-md)',
  },
  name: {
    fontSize: 'var(--font-body)',
    fontWeight: 500,
    color: 'var(--color-text)',
  },
  meta: {
    fontSize: 'var(--font-footnote)',
    color: 'var(--color-text-muted)',
    marginTop: '2px',
  },
  error: {
    fontSize: 'var(--font-footnote)',
    color: 'var(--color-danger)',
    marginTop: 'var(--space-sm)',
  },
  empty: {
    textAlign: 'center',
    padding: 'var(--space-xl)',
    color: 'var(--color-text-muted)',
    fontSize: 'var(--font-subhead)',
  },
  sheetBody: {
    padding: 'var(--space-lg) var(--space-xl)',
  },
  jsonBlock: {
    fontSize: 'var(--font-caption)',
    fontFamily: 'SF Mono, Menlo, monospace',
    background: 'var(--color-bg)',
    borderRadius: 'var(--radius-sm)',
    padding: 'var(--space-lg)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    color: 'var(--color-text-secondary)',
    overflowX: 'auto',
    maxHeight: '40vh',
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
  },
  deleteBtn: {
    width: '100%',
    padding: '14px',
    marginTop: 'var(--space-xl)',
    background: 'var(--color-bg)',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    fontSize: 'var(--font-body)',
    fontWeight: 500,
    color: 'var(--color-danger)',
    textAlign: 'center',
  },
}

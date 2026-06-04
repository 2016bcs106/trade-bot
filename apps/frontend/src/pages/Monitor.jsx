import { useState } from 'react'
import moment from 'moment'
import { ref, remove } from 'firebase/database'
import { db } from '../utils/firebase'
import Page from '../components/Page'
import PageHeader from '../components/PageHeader'
import SectionHeader from '../components/SectionHeader'
import Badge from '../components/Badge'
import DetailRow from '../components/DetailRow'
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

export default function Monitor() {
  const { scripts, requestQueue: requests, failedRequests } = useApp()
  const [sheetData, setSheetData] = useState(null)

  if (scripts === undefined) {
    return <Page><Loader /></Page>
  }

  const scriptEntries = scripts ? Object.entries(scripts) : []

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
      {scriptEntries.length === 0 ? (
        <div style={styles.emptyCard}><span style={styles.emptyText}>No scripts reporting</span></div>
      ) : (
        <div style={styles.list}>
          {scriptEntries.map(([name, data], i) => {
            const status = data.status || 'stopped'
            const color = STATUS_COLORS[status] || STATUS_COLORS.stopped
            return (
              <div
                key={name}
                style={{ ...styles.row, ...(i < scriptEntries.length - 1 ? styles.bordered : {}) }}
                onClick={() => setSheetData({ title: name, data, type: 'script' })}
              >
                <div style={styles.info}>
                  <span style={styles.name}>{name}</span>
                  <span style={styles.meta}>{data.lastHeartbeat ? moment(data.lastHeartbeat).fromNow() : '—'}</span>
                </div>
                <Badge label={status} color={color} />
              </div>
            )
          })}
        </div>
      )}

      <SectionHeader>Requests</SectionHeader>
      {allRequests.length === 0 ? (
        <div style={styles.emptyCard}><span style={styles.emptyText}>No requests</span></div>
      ) : (
        <div style={styles.list}>
          {allRequests.map((req, i) => (
            <div
              key={req._key}
              style={{ ...styles.row, ...(i < allRequests.length - 1 ? styles.bordered : {}) }}
              onClick={() => setSheetData({ title: req.type, data: req, type: 'request' })}
            >
              <div style={styles.info}>
                <span style={styles.name}>{req.type}</span>
                <span style={styles.meta}>
                  {req.createdAt ? moment(req.createdAt).fromNow() : '—'}
                  {req.payload && Object.keys(req.payload).length > 0 && (
                    <span> · {Object.entries(req.payload).map(([k, v]) => `${k}: ${v}`).join(', ')}</span>
                  )}
                </span>
              </div>
              <Badge label={req.status} color={REQUEST_COLORS[req.status] || REQUEST_COLORS.pending} />
            </div>
          ))}
        </div>
      )}

      <BottomSheet title={sheetData?.title} isOpen={!!sheetData} onClose={() => setSheetData(null)}>
        {sheetData && (
          <div style={styles.sheetBody}>
            {sheetData.type === 'script' && (() => {
              const d = sheetData.data
              const meta = d.metadata || {}
              return (
                <>
                  <DetailRow label="Status" value={d.status} />
                  <DetailRow label="Last Heartbeat" value={d.lastHeartbeat ? moment(d.lastHeartbeat).fromNow() : undefined} />
                  <DetailRow label="Started" value={d.startedAt ? moment(d.startedAt).fromNow() : undefined} />
                  {d.error && <DetailRow label="Error" value={d.error} />}
                  {Object.entries(meta).map(([key, val]) => (
                    <DetailRow key={key} label={key} value={val != null ? String(val) : undefined} />
                  ))}
                </>
              )
            })()}
            {sheetData.type === 'request' && (() => {
              const d = sheetData.data
              return (
                <>
                  <DetailRow label="Type" value={d.type} />
                  <DetailRow label="Status" value={d.status} />
                  <DetailRow label="Created" value={d.createdAt ? moment(d.createdAt).fromNow() : undefined} />
                  {d.payload && Object.entries(d.payload).map(([key, val]) => (
                    <DetailRow key={key} label={key} value={val != null ? String(val) : undefined} />
                  ))}
                  {d.error && <DetailRow label="Error" value={d.error} />}
                  {d._source === 'failed' && (
                    <button style={styles.deleteBtn} onClick={() => handleDeleteFailed(d._key)}>
                      Delete Failed Request
                    </button>
                  )}
                </>
              )
            })()}
          </div>
        )}
      </BottomSheet>
    </Page>
  )
}

const styles = {
  list: {
    background: 'var(--color-card)',
    borderRadius: 'var(--radius-md)',
    overflow: 'hidden',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    padding: '14px var(--space-lg)',
    cursor: 'pointer',
    gap: 'var(--space-md)',
    minHeight: '56px',
  },
  bordered: {
    borderBottom: '1px solid var(--color-border)',
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    display: 'block',
    fontSize: 'var(--font-body)',
    fontWeight: 500,
    color: 'var(--color-text)',
  },
  meta: {
    display: 'block',
    fontSize: 'var(--font-footnote)',
    color: 'var(--color-text-muted)',
    marginTop: '2px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  emptyCard: {
    background: 'var(--color-card)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-xl)',
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 'var(--font-subhead)',
    color: 'var(--color-text-muted)',
  },
  sheetBody: {
    padding: 'var(--space-lg) var(--space-xl)',
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

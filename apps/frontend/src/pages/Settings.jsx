import { useState } from 'react'
import moment from 'moment'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowRotateRight, faServer, faCheck, faFlask } from '@fortawesome/free-solid-svg-icons'
import { db, ref, push } from '../utils/firebase'
import Page from '../components/Page'
import PageHeader from '../components/PageHeader'
import SectionHeader from '../components/SectionHeader'
import { CardList } from '../components/Card'
import ListItem from '../components/ListItem'
import Toggle from '../components/Toggle'
import BottomSheet from '../components/BottomSheet'

export function getSignalSource() {
  try { return localStorage.getItem('signalSource') || 'frontend' } catch { return 'frontend' }
}

export default function Settings() {
  const [updateQueued, setUpdateQueued] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [signalSource, setSignalSource] = useState(getSignalSource)

  const handleSystemUpdate = async () => {
    setConfirmOpen(false)
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
    <Page>
      <PageHeader title="Settings" />

      <SectionHeader>General</SectionHeader>
      <CardList>
        <ListItem
          icon={faArrowRotateRight}
          iconColor="var(--color-primary)"
          title="Force Reload"
          subtitle="Clear cache and reload"
          onClick={() => window.location.reload(true)}
          isLast
        />
      </CardList>

      <SectionHeader>Experimental</SectionHeader>
      <CardList>
        <div style={styles.toggleWrap}>
          <Toggle
            label={`Signal source: ${signalSource === 'backend' ? 'Backend' : 'Frontend'}`}
            enabled={signalSource === 'backend'}
            onToggle={() => {
              const next = signalSource === 'backend' ? 'frontend' : 'backend'
              setSignalSource(next)
              localStorage.setItem('signalSource', next)
            }}
          />
        </div>
      </CardList>

      <SectionHeader>System</SectionHeader>
      <CardList>
        <ListItem
          icon={updateQueued ? faCheck : faServer}
          iconColor={updateQueued ? 'var(--color-success)' : '#8e8e93'}
          title="System Update"
          subtitle={updateQueued ? 'Queued — worker will pull & restart' : 'Pull latest code, deploy, restart'}
          onClick={!updateQueued ? () => setConfirmOpen(true) : undefined}
          isLast
        />
      </CardList>

      <BottomSheet title="System Update" isOpen={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <div style={styles.confirmBody}>
          <p style={styles.confirmText}>This will pull the latest code, deploy frontend changes, and restart backend services.</p>
          <p style={styles.confirmText}>Proceed?</p>
          <div style={styles.confirmActions}>
            <button style={styles.cancelBtn} onClick={() => setConfirmOpen(false)}>Cancel</button>
            <button style={styles.confirmBtn} onClick={handleSystemUpdate}>Update</button>
          </div>
        </div>
      </BottomSheet>
    </Page>
  )
}

const styles = {
  toggleWrap: {
    padding: '4px var(--space-lg)',
  },
  confirmBody: {
    padding: 'var(--space-lg) var(--space-xl)',
  },
  confirmText: {
    fontSize: 'var(--font-body)',
    color: 'var(--color-text-muted)',
    marginBottom: 'var(--space-md)',
  },
  confirmActions: {
    display: 'flex',
    gap: 'var(--space-sm)',
    marginTop: 'var(--space-xl)',
  },
  cancelBtn: {
    flex: 1,
    padding: '14px',
    background: 'var(--color-bg)',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--font-body)',
    fontWeight: 500,
    color: 'var(--color-text)',
    cursor: 'pointer',
  },
  confirmBtn: {
    flex: 1,
    padding: '14px',
    background: 'var(--color-primary)',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--font-body)',
    fontWeight: 600,
    color: '#fff',
    cursor: 'pointer',
  },
}

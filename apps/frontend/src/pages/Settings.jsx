import { useState, useEffect } from 'react'
import moment from 'moment'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowRotateRight, faServer, faCheck, faBell, faUser, faArrowRightToBracket } from '@fortawesome/free-solid-svg-icons'
import { db, ref, push, set, onValue } from '../utils/firebase'
import { subscribeToPush, unsubscribeFromPush } from '../utils/push'
import Page from '../components/Page'
import PageHeader from '../components/PageHeader'
import SectionHeader from '../components/SectionHeader'
import { CardList } from '../components/Card'
import ListItem from '../components/ListItem'
import Badge from '../components/Badge'
import BottomSheet from '../components/BottomSheet'
import { useGoogleAuth } from '../components/GoogleAuthGuard'

export function getSignalSource() {
  try { return localStorage.getItem('signalSource') || 'backend' } catch { return 'backend' }
}

function InlineToggle({ enabled, onToggle }) {
  return (
    <div onClick={(e) => { e.stopPropagation(); onToggle() }} style={{ ...toggleStyles.track, background: enabled ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}>
      <div style={{ ...toggleStyles.thumb, transform: enabled ? 'translateX(20px)' : 'translateX(0)' }} />
    </div>
  )
}

export default function Settings() {
  const { user, isAdmin, signOut } = useGoogleAuth()
  const [updateQueued, setUpdateQueued] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [signalSource, setSignalSource] = useState(getSignalSource)
  const [notifyOnRestart, setNotifyOnRestart] = useState(false)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [dhanAutoTrade, setDhanAutoTrade] = useState(false)

  useEffect(() => {
    return onValue(ref(db, 'config/notifyOnRestart'), (snap) => {
      setNotifyOnRestart(!!snap.val())
    })
  }, [])

  useEffect(() => {
    return onValue(ref(db, 'config/pushNotificationsEnabled'), (snap) => {
      setPushEnabled(!!snap.val())
    })
  }, [])

  useEffect(() => {
    return onValue(ref(db, 'config/dhanAutoTrade'), (snap) => {
      setDhanAutoTrade(!!snap.val())
    })
  }, [])

  const handlePushToggle = async () => {
    try {
      if (!pushEnabled) await subscribeToPush()
      else await unsubscribeFromPush()
      set(ref(db, 'config/pushNotificationsEnabled'), !pushEnabled || null)
    } catch (err) {
      console.error('Push toggle failed', err)
    }
  }

  const handleSystemUpdate = async () => {
    setConfirmOpen(false)
    await push(ref(db, 'request_queue'), {
      type: 'system_update',
      payload: { force: true },
      status: 'pending',
      createdAt: moment().utcOffset('+05:30').toISOString(),
    })
    setUpdateQueued(true)
    setTimeout(() => setUpdateQueued(false), 3000)
  }

  return (
    <Page>
      <PageHeader title="Settings" />

      <SectionHeader>Account</SectionHeader>
      <CardList>
        <ListItem
          icon={faUser}
          iconColor="var(--color-primary)"
          title={user?.email || '—'}
          right={isAdmin ? <Badge label="Admin" color="var(--color-primary)" /> : null}
        />
        <ListItem
          icon={faArrowRightToBracket}
          iconColor="var(--color-danger)"
          title="Sign out"
          onClick={signOut}
          isLast
        />
      </CardList>

      <SectionHeader>General</SectionHeader>
      <CardList>
        <ListItem
          icon={faArrowRotateRight}
          iconColor="var(--color-primary)"
          title="Force Reload"
          subtitle="Clear cache and reload the app"
          onClick={() => window.location.reload(true)}
        />
        <ListItem
          icon={updateQueued ? faCheck : faServer}
          iconColor={updateQueued ? 'var(--color-success)' : '#8e8e93'}
          title="Force System Update"
          subtitle={updateQueued ? 'Queued — worker will pull & restart' : 'Pull, deploy frontend & backend, restart all'}
          onClick={!updateQueued ? () => setConfirmOpen(true) : undefined}
          isLast
        />
      </CardList>

      <SectionHeader>Notifications</SectionHeader>
      <CardList>
        <ListItem
          icon={faBell}
          iconColor="var(--color-primary)"
          title="Push notifications"
          subtitle="Get notified when your Paytm Money login expires"
          right={<InlineToggle enabled={pushEnabled} onToggle={handlePushToggle} />}
          isLast
        />
      </CardList>

      <SectionHeader>Trading</SectionHeader>
      <CardList>
        <ListItem
          title="Dhan Auto Trade"
          subtitle="Auto buy/sell on Dhan based on daily signals at 10 AM IST"
          right={<InlineToggle enabled={dhanAutoTrade} onToggle={() => {
            set(ref(db, 'config/dhanAutoTrade'), !dhanAutoTrade || null)
          }} />}
          isLast
        />
      </CardList>

      <SectionHeader>Experimental</SectionHeader>
      <CardList>
        <ListItem
          title="Use backend signals"
          subtitle="When off, signals are computed in the browser instead of the server"
          right={<InlineToggle enabled={signalSource === 'backend'} onToggle={() => {
            const next = signalSource === 'backend' ? 'frontend' : 'backend'
            setSignalSource(next)
            localStorage.setItem('signalSource', next)
          }} />}
        />
        <ListItem
          title="Notify signals on restart"
          subtitle="Send Slack notification for historical signals when server restarts"
          right={<InlineToggle enabled={notifyOnRestart} onToggle={() => {
            set(ref(db, 'config/notifyOnRestart'), !notifyOnRestart || null)
          }} />}
          isLast
        />
      </CardList>

      <BottomSheet title="Force System Update" isOpen={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <div style={styles.confirmBody}>
          <p style={styles.confirmText}>This will force pull the latest code, deploy both frontend and backend, and restart all services regardless of changes.</p>
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

const toggleStyles = {
  track: {
    width: '51px',
    height: '31px',
    borderRadius: '16px',
    padding: '2px',
    cursor: 'pointer',
    transition: 'background 0.25s ease',
  },
  thumb: {
    width: '27px',
    height: '27px',
    borderRadius: '14px',
    background: '#fff',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
    transition: 'transform 0.25s ease',
  },
}

const styles = {
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

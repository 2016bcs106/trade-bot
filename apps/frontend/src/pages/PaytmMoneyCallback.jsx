import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import moment from 'moment'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSpinner } from '@fortawesome/free-solid-svg-icons'
import { db, ref, onValue, push } from '../utils/firebase'

const TIMEOUT_MS = 30000

export default function PaytmMoneyCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [status, setStatus] = useState('Authenticating...')

  useEffect(() => {
    const requestToken = searchParams.get('requestToken')
    if (!requestToken) { navigate('/login', { replace: true }); return }

    let unsubscribe = null
    let timeoutId = null

    async function processCallback() {
      try {
        const requestTime = moment().utcOffset('+05:30').valueOf()

        await push(ref(db, 'request_queue'), {
          type: 'access_token',
          payload: { requestToken },
          status: 'pending',
          createdAt: moment().utcOffset('+05:30').toISOString(),
        })

        setStatus('Waiting for access token...')

        const updatedOnRef = ref(db, 'auth/updatedOn')
        unsubscribe = onValue(updatedOnRef, (snapshot) => {
          const updatedOn = snapshot.val()
          if (updatedOn && updatedOn >= requestTime) {
            cleanup()
            navigate('/', { replace: true })
          }
        })

        timeoutId = setTimeout(() => {
          cleanup()
          setStatus('Timed out. Please try again.')
          setTimeout(() => navigate('/login', { replace: true }), 2000)
        }, TIMEOUT_MS)
      } catch {
        setStatus('Authentication failed. Please try again.')
        setTimeout(() => navigate('/login', { replace: true }), 2000)
      }
    }

    function cleanup() {
      if (unsubscribe) unsubscribe()
      if (timeoutId) clearTimeout(timeoutId)
    }

    processCallback()
    return cleanup
  }, [searchParams, navigate])

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <FontAwesomeIcon icon={faSpinner} spin style={styles.icon} />
        <p style={styles.text}>{status}</p>
      </div>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--color-bg)',
  },
  card: {
    background: 'var(--color-card)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--color-border)',
    padding: '2rem 3rem',
    textAlign: 'center',
  },
  icon: {
    fontSize: '1.5rem',
    color: 'var(--color-primary)',
    marginBottom: 'var(--space-lg)',
  },
  text: {
    fontSize: 'var(--font-md)',
    color: 'var(--color-text-muted)',
  },
}

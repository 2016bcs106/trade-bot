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

        setStatus('Waiting for token...')

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
          setStatus('Timed out. Redirecting...')
          setTimeout(() => navigate('/login', { replace: true }), 2000)
        }, TIMEOUT_MS)
      } catch {
        setStatus('Failed. Redirecting...')
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
      <FontAwesomeIcon icon={faSpinner} spin style={styles.icon} />
      <p style={styles.text}>{status}</p>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--color-bg)',
    gap: 'var(--space-lg)',
  },
  icon: {
    fontSize: '1.25rem',
    color: 'var(--color-text-muted)',
  },
  text: {
    fontSize: 'var(--font-body)',
    color: 'var(--color-text-muted)',
  },
}

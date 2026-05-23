import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import moment from 'moment'
import { db, ref, set, onValue } from '../utils/firebase'
import { layout, text, card, merge } from '../utils/styles'

const TIMEOUT_MS = 30000 // 30 second timeout

export default function PaytmMoneyCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [status, setStatus] = useState('Authenticating...')

  useEffect(() => {
    const requestToken = searchParams.get('requestToken')

    if (!requestToken) {
      navigate('/login', { replace: true })
      return
    }

    let unsubscribe = null
    let timeoutId = null

    async function processCallback() {
      try {
        const requestTime = moment().utcOffset('+05:30').valueOf()

        await set(ref(db, 'auth/requestToken'), {
          token: requestToken,
          date: moment().utcOffset('+05:30').format('YYYY-MM-DD'),
          timestamp: requestTime,
        })

        setStatus('Waiting for access token...')

        // Listen to updatedOn - navigate only when it's updated AFTER our request
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
          setStatus('Timed out waiting for access token. Please try again.')
          setTimeout(() => navigate('/login', { replace: true }), 2000)
        }, TIMEOUT_MS)

      } catch (error) {
        console.error('Callback error:', error)
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
    <div style={merge(layout.page, layout.center)}>
      <div style={merge(card.base, { padding: '2rem 3rem', textAlign: 'center' })}>
        <div style={{ marginBottom: '1rem', fontSize: '1.5rem' }}>⏳</div>
        <p style={text.muted}>{status}</p>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { setAuth } from '../utils/auth'
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
        const today = new Date().toISOString().split('T')[0]
        await set(ref(db, 'auth/requestToken'), {
          token: requestToken,
          date: today,
          timestamp: Date.now(),
        })

        setStatus('Waiting for access token...')

        const accessTokenRef = ref(db, 'auth/accessToken')
        unsubscribe = onValue(accessTokenRef, (snapshot) => {
          const data = snapshot.val()
          if (data && data.token) {
            setAuth(data.token)
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

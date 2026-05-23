import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import moment from 'moment'
import { db, ref, onValue } from '../utils/firebase'
import { layout, card, text, button, divider, merge } from '../utils/styles'

const qrContainer = {
  background: 'var(--pm-primary-light)',
  borderRadius: '16px',
  padding: '1.5rem',
  display: 'inline-block',
  marginBottom: '1.5rem',
}

const qrPlaceholder = {
  width: '200px',
  height: '200px',
  background: `repeating-conic-gradient(#c7d2fe 0% 25%, #ffffff 0% 50%) 50% / 20px 20px`,
  borderRadius: '8px',
  border: '2px solid var(--pm-border)',
}

const loginUrl = `${import.meta.env.VITE_PAYTM_MONEY_LOGIN_BASE_URL}?apiKey=${import.meta.env.VITE_PAYTM_MONEY_API_KEY}&state=${import.meta.env.VITE_PAYTM_MONEY_API_SECRET}`

function isTokenFreshToday(updatedOnTimestamp) {
  if (!updatedOnTimestamp) return false

  const updatedMoment = moment(updatedOnTimestamp)
  const startOfTodayIST = moment().utcOffset('+05:30').startOf('day')

  return updatedMoment.isSameOrAfter(startOfTodayIST)
}

export default function Login() {
  const navigate = useNavigate()

  useEffect(() => {
    const updatedOnRef = ref(db, 'auth/updatedOn')
    const unsubscribe = onValue(updatedOnRef, (snapshot) => {
      const updatedOn = snapshot.val()
      if (isTokenFreshToday(updatedOn)) {
        navigate('/', { replace: true })
      }
    })

    return () => unsubscribe()
  }, [navigate])

  function handleLogin() {
    window.location.href = loginUrl
  }

  return (
    <div style={merge(layout.page, layout.center, { padding: '2rem' })}>
      <div style={layout.column}>
        <div style={merge(text.logo, { fontSize: '1.5rem', marginBottom: '2rem' })}>Trade Bot</div>
        <div style={merge(card.base, card.padded, { maxWidth: '400px', width: '100%', textAlign: 'center' })}>
          
          <div style={qrContainer}>
            <div style={qrPlaceholder} />
          </div>

          <p style={merge(text.muted, { marginBottom: '2rem' })}>
            Scan the QR code with your camera app to login</p>

          <div style={merge(divider.container, { marginBottom: '1.5rem' })}>
            <div style={divider.line} />
            <span style={divider.text}>or</span>
            <div style={divider.line} />
          </div>

          <button
            style={button.primary}
            onClick={handleLogin}
            onMouseOver={(e) => e.target.style.background = '#1544b8'}
            onMouseOut={(e) => e.target.style.background = 'var(--pm-primary)'}
          >
            Login with Paytm Money
          </button>
        </div>
      </div>
    </div>
  )
}

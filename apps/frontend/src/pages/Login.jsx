import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import moment from 'moment'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faRightToBracket } from '@fortawesome/free-solid-svg-icons'
import { db, ref, onValue } from '../utils/firebase'

const loginUrl = `${import.meta.env.VITE_PAYTM_MONEY_LOGIN_BASE_URL}?apiKey=${import.meta.env.VITE_PAYTM_MONEY_API_KEY}&state=${import.meta.env.VITE_PAYTM_MONEY_API_SECRET}`

function isTokenFreshToday(updatedOnTimestamp) {
  if (!updatedOnTimestamp) return false
  return moment(updatedOnTimestamp).isSameOrAfter(moment().utcOffset('+05:30').startOf('day'))
}

export default function Login() {
  const navigate = useNavigate()

  useEffect(() => {
    const updatedOnRef = ref(db, 'auth/updatedOn')
    const unsubscribe = onValue(updatedOnRef, (snapshot) => {
      if (isTokenFreshToday(snapshot.val())) {
        navigate('/', { replace: true })
      }
    })
    return () => unsubscribe()
  }, [navigate])

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>Trade Bot</div>
        <p style={styles.subtitle}>Sign in to manage your stocks and live data</p>
        <button style={styles.button} onClick={() => { window.location.href = loginUrl }}>
          <FontAwesomeIcon icon={faRightToBracket} />
          Login with Paytm Money
        </button>
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
    padding: 'var(--space-xl)',
    background: 'var(--color-bg)',
  },
  card: {
    background: 'var(--color-card)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--color-border)',
    boxShadow: 'var(--shadow-md)',
    padding: '3rem 2.5rem',
    maxWidth: '380px',
    width: '100%',
    textAlign: 'center',
  },
  logo: {
    fontSize: 'var(--font-2xl)',
    fontWeight: 700,
    color: 'var(--color-primary)',
    marginBottom: 'var(--space-sm)',
  },
  subtitle: {
    fontSize: 'var(--font-md)',
    color: 'var(--color-text-muted)',
    marginBottom: 'var(--space-xl)',
  },
  button: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-sm)',
    width: '100%',
    padding: '0.875rem',
    background: 'var(--color-primary)',
    color: '#ffffff',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--font-md)',
    fontWeight: 600,
    cursor: 'pointer',
  },
}

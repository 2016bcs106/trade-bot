import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import moment from 'moment'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowRightToBracket } from '@fortawesome/free-solid-svg-icons'
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
      <div style={styles.content}>
        <h1 style={styles.title}>Trade Bot</h1>
        <p style={styles.subtitle}>Sign in to continue</p>
        <button style={styles.button} onClick={() => { window.location.href = loginUrl }}>
          <FontAwesomeIcon icon={faArrowRightToBracket} />
          <span>Sign in with Paytm Money</span>
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
    background: 'var(--color-bg)',
    padding: 'var(--space-xl)',
  },
  content: {
    textAlign: 'center',
    width: '100%',
    maxWidth: '320px',
  },
  title: {
    fontSize: 'var(--font-largetitle)',
    fontWeight: 700,
    color: 'var(--color-text)',
    letterSpacing: '-0.5px',
    marginBottom: 'var(--space-sm)',
  },
  subtitle: {
    fontSize: 'var(--font-body)',
    color: 'var(--color-text-muted)',
    marginBottom: 'var(--space-2xl)',
  },
  button: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-sm)',
    width: '100%',
    padding: '16px',
    background: 'var(--color-primary)',
    color: '#ffffff',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--font-body)',
    fontWeight: 600,
    cursor: 'pointer',
  },
}

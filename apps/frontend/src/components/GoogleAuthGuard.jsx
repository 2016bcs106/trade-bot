import { useState, useEffect, createContext, useContext } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSpinner, faArrowRightToBracket, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import { db, ref, onValue, auth, googleProvider, signInWithPopup, onAuthStateChanged, signOut } from '../utils/firebase'

const GoogleAuthContext = createContext(null)

export function useGoogleAuth() {
  const ctx = useContext(GoogleAuthContext)
  if (!ctx) throw new Error('useGoogleAuth must be used within GoogleAuthGuard')
  return ctx
}

function emailKey(email) {
  return email.trim().toLowerCase().replace(/\./g, ',')
}

export default function GoogleAuthGuard({ children }) {
  const [status, setStatus] = useState('loading')
  const [user, setUser] = useState(null)
  const [role, setRole] = useState(null)

  useEffect(() => {
    return onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser)
      if (!firebaseUser) {
        setRole(null)
        setStatus('signed-out')
      }
    })
  }, [])

  useEffect(() => {
    if (!user) return
    if (!user.email) { setStatus('unauthorized'); return }
    const key = emailKey(user.email)
    return onValue(ref(db, `allowedUsers/${key}`), (snap) => {
      const data = snap.val()
      if (data) {
        setRole(data.role || 'user')
        setStatus('authorized')
      } else {
        setRole(null)
        setStatus('unauthorized')
      }
    })
  }, [user])

  if (status === 'loading') {
    return (
      <div style={styles.center}>
        <FontAwesomeIcon icon={faSpinner} spin style={styles.spinner} />
      </div>
    )
  }

  if (status === 'signed-out') {
    return (
      <div style={styles.page}>
        <div style={styles.content}>
          <h1 style={styles.title}>Trade Bot</h1>
          <p style={styles.subtitle}>Sign in to continue</p>
          <button style={styles.button} onClick={() => signInWithPopup(auth, googleProvider).catch(() => {})}>
            <FontAwesomeIcon icon={faArrowRightToBracket} />
            <span>Sign in with Google</span>
          </button>
        </div>
      </div>
    )
  }

  if (status === 'unauthorized') {
    return (
      <div style={styles.page}>
        <div style={styles.content}>
          <FontAwesomeIcon icon={faTriangleExclamation} style={styles.warnIcon} />
          <h1 style={styles.title}>Access Restricted</h1>
          <p style={styles.subtitle}>{user?.email} is not authorized to use this app.</p>
          <button style={{ ...styles.button, background: 'var(--color-danger)' }} onClick={() => signOut(auth)}>
            <span>Sign out</span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <GoogleAuthContext.Provider value={{ user, role, isAdmin: role === 'admin', signOut: () => signOut(auth) }}>
      {children}
    </GoogleAuthContext.Provider>
  )
}

const styles = {
  center: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    fontSize: '1.5rem',
    color: 'var(--color-primary)',
  },
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
  warnIcon: {
    fontSize: '2rem',
    color: 'var(--color-warning)',
    marginBottom: 'var(--space-lg)',
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

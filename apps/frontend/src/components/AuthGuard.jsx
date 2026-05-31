import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import moment from 'moment'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSpinner } from '@fortawesome/free-solid-svg-icons'
import { db, ref, onValue } from '../utils/firebase'

function isTokenFreshToday(updatedOnTimestamp) {
  if (!updatedOnTimestamp) return false
  const updatedMoment = moment(updatedOnTimestamp)
  const startOfTodayIST = moment().utcOffset('+05:30').startOf('day')
  return updatedMoment.isSameOrAfter(startOfTodayIST)
}

export default function AuthGuard({ children }) {
  const [authState, setAuthState] = useState('loading')

  useEffect(() => {
    let latestUpdatedOn = null

    const checkAuth = () => {
      setAuthState(isTokenFreshToday(latestUpdatedOn) ? 'authenticated' : 'unauthenticated')
    }

    const updatedOnRef = ref(db, 'auth/updatedOn')
    const unsubscribe = onValue(updatedOnRef, (snapshot) => {
      latestUpdatedOn = snapshot.val()
      checkAuth()
    }, () => {
      setAuthState('unauthenticated')
    })

    const nowIST = moment().utcOffset('+05:30')
    const midnightIST = nowIST.clone().endOf('day').add(1, 'millisecond')
    const midnightTimer = setTimeout(checkAuth, midnightIST.diff(nowIST))

    return () => { unsubscribe(); clearTimeout(midnightTimer) }
  }, [])

  if (authState === 'loading') {
    return (
      <div style={styles.center}>
        <FontAwesomeIcon icon={faSpinner} spin style={styles.spinner} />
      </div>
    )
  }

  if (authState === 'unauthenticated') {
    return <Navigate to="/login" replace />
  }

  return children
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
}

import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import moment from 'moment'
import { db, ref, onValue } from '../utils/firebase'
import { layout, text, card, merge } from '../utils/styles'

function isTokenFreshToday(updatedOnTimestamp) {
  if (!updatedOnTimestamp) return false

  const updatedMoment = moment(updatedOnTimestamp)
  const startOfTodayIST = moment().utcOffset('+05:30').startOf('day')

  return updatedMoment.isSameOrAfter(startOfTodayIST)
}

export default function AuthGuard({ children }) {
  const [authState, setAuthState] = useState('loading') // 'loading' | 'authenticated' | 'unauthenticated'

  useEffect(() => {
    let latestUpdatedOn = null

    const checkAuth = () => {
      if (isTokenFreshToday(latestUpdatedOn)) {
        setAuthState('authenticated')
      } else {
        setAuthState('unauthenticated')
      }
    }

    // Listen for Firebase auth/updatedOn changes
    const updatedOnRef = ref(db, 'auth/updatedOn')
    const unsubscribe = onValue(updatedOnRef, (snapshot) => {
      latestUpdatedOn = snapshot.val()
      checkAuth()
    }, (error) => {
      console.error('Error reading updatedOn from Firebase:', error)
      setAuthState('unauthenticated')
    })

    // Schedule re-check at midnight IST so session expires without page refresh
    const nowIST = moment().utcOffset('+05:30')
    const midnightIST = nowIST.clone().endOf('day').add(1, 'millisecond')
    const msUntilMidnight = midnightIST.diff(nowIST)

    const midnightTimer = setTimeout(() => {
      checkAuth()
    }, msUntilMidnight)

    return () => {
      unsubscribe()
      clearTimeout(midnightTimer)
    }
  }, [])

  if (authState === 'loading') {
    return (
      <div style={merge(layout.page, layout.center)}>
        <div style={merge(card.base, { padding: '2rem 3rem', textAlign: 'center' })}>
          <div style={{ marginBottom: '1rem', fontSize: '1.5rem' }}>⏳</div>
          <p style={text.muted}>Checking authentication...</p>
        </div>
      </div>
    )
  }

  if (authState === 'unauthenticated') {
    return <Navigate to="/login" replace />
  }

  return children
}

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
    const updatedOnRef = ref(db, 'auth/updatedOn')
    const unsubscribe = onValue(updatedOnRef, (snapshot) => {
      const updatedOn = snapshot.val()
      if (isTokenFreshToday(updatedOn)) {
        setAuthState('authenticated')
      } else {
        setAuthState('unauthenticated')
      }
    }, (error) => {
      console.error('Error reading updatedOn from Firebase:', error)
      setAuthState('unauthenticated')
    })

    return () => unsubscribe()
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

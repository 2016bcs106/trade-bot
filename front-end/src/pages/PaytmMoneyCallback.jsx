import { useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { setAuth } from '../utils/auth'
import { layout, text, merge } from '../utils/styles'

export default function PaytmMoneyCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  useEffect(() => {
    const requestToken = searchParams.get('requestToken')
    if (requestToken) {
      setAuth(requestToken)
      navigate('/', { replace: true })
    } else {
      navigate('/login', { replace: true })
    }
  }, [searchParams, navigate])

  return (
    <div style={merge(layout.page, layout.center)}>
      <p style={text.muted}>Authenticating...</p>
    </div>
  )
}

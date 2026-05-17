import { useSearchParams } from 'react-router-dom'
import { clearAuth } from '../utils/auth'
import { layout, card, text, button, header, merge } from '../utils/styles'

export default function Home() {
  const [searchParams] = useSearchParams()

  function handleLogout() {
    clearAuth()
    window.location.href = '/login'
  }

  return (
    <div style={layout.page}>
      <header style={header.bar}>
        <span style={text.logo}>Trade Bot</span>
        <button
          style={button.outline}
          onClick={handleLogout}
          onMouseOver={(e) => e.target.style.background = 'var(--pm-bg)'}
          onMouseOut={(e) => e.target.style.background = 'transparent'}
        >
          Logout
        </button>
      </header>
      <div style={layout.center}>
        <div style={merge(card.base, { padding: '3rem 4rem', textAlign: 'center' })}>
          <h1 style={merge(text.heroHeading, { marginBottom: '0.5rem' })}>Hello World 👋</h1>
          <p style={text.muted}>Session valid until midnight today</p>
        </div>
      </div>
    </div>
  )
}

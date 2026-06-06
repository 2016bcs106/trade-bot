import { Component } from 'react'

export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div style={styles.wrap}>
        <div style={styles.card}>
          <div style={styles.title}>Something went wrong</div>
          <pre style={styles.error}>{this.state.error.message || String(this.state.error)}</pre>
          <button style={styles.btn} onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    )
  }
}

const styles = {
  wrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    padding: '24px',
    background: 'var(--color-bg)',
  },
  card: {
    background: 'var(--color-card)',
    borderRadius: 'var(--radius-lg)',
    padding: '32px 24px',
    maxWidth: '400px',
    width: '100%',
    textAlign: 'center',
    boxShadow: 'var(--shadow-card)',
  },
  title: {
    fontSize: 'var(--font-title2)',
    fontWeight: 700,
    color: 'var(--color-text)',
    marginBottom: '16px',
  },
  error: {
    fontSize: 'var(--font-footnote)',
    color: 'var(--color-danger)',
    background: 'rgba(255, 59, 48, 0.06)',
    borderRadius: 'var(--radius-md)',
    padding: '12px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    textAlign: 'left',
    marginBottom: '24px',
    maxHeight: '200px',
    overflow: 'auto',
  },
  btn: {
    padding: '12px 32px',
    fontSize: 'var(--font-body)',
    fontWeight: 600,
    color: '#fff',
    background: 'var(--color-primary)',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
  },
}

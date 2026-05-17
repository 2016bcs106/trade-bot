// Reusable style primitives for consistent Paytm Money-like UI

export const layout = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--pm-bg)',
  },
  center: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  column: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
}

export const card = {
  base: {
    background: 'var(--pm-card-bg)',
    borderRadius: '16px',
    border: '1px solid var(--pm-border)',
    boxShadow: '0 2px 12px rgba(0, 0, 0, 0.06)',
  },
  padded: {
    padding: '2.5rem',
  },
}

export const text = {
  logo: {
    fontSize: '1.25rem',
    fontWeight: '700',
    color: 'var(--pm-primary)',
  },
  heading: {
    fontSize: '1.25rem',
    fontWeight: '600',
    color: 'var(--pm-text)',
  },
  heroHeading: {
    fontSize: '2rem',
    fontWeight: '700',
    color: 'var(--pm-text)',
  },
  muted: {
    fontSize: '0.875rem',
    color: 'var(--pm-text-muted)',
  },
  small: {
    fontSize: '0.8rem',
    color: 'var(--pm-text-muted)',
  },
}

export const button = {
  primary: {
    display: 'block',
    width: '100%',
    padding: '0.875rem',
    background: 'var(--pm-primary)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '10px',
    fontSize: '0.95rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'background 0.2s',
  },
  outline: {
    padding: '0.5rem 1.25rem',
    background: 'transparent',
    color: 'var(--pm-text-secondary)',
    border: '1px solid var(--pm-border)',
    borderRadius: '8px',
    fontSize: '0.85rem',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'background 0.2s',
  },
}

export const header = {
  bar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1rem 2rem',
    background: 'var(--pm-card-bg)',
    borderBottom: '1px solid var(--pm-border)',
    boxShadow: '0 1px 4px rgba(0, 0, 0, 0.04)',
  },
}

export const divider = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
  },
  line: {
    flex: 1,
    height: '1px',
    background: 'var(--pm-border)',
  },
  text: {
    fontSize: '0.75rem',
    color: 'var(--pm-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '1px',
  },
}

// Merge multiple style objects
export const merge = (...styles) => Object.assign({}, ...styles)

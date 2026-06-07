export const chartHeaderStyles = {
  row: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 'var(--space-sm)',
    marginBottom: 'var(--space-sm)',
  },
  value: {
    fontSize: 'var(--font-title1)',
    fontWeight: 600,
    color: 'var(--color-text)',
    letterSpacing: '-0.5px',
  },
  change: {
    fontSize: 'var(--font-subhead)',
    fontWeight: 600,
  },
}

export const chartStyles = {
  section: {
    marginBottom: 'var(--space-lg)',
    background: 'var(--color-card)',
    borderRadius: 'var(--radius-md)',
    marginLeft: 'var(--space-lg)',
    marginRight: 'var(--space-lg)',
    padding: 'var(--space-lg) var(--space-md)',
  },
  labelRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 'var(--space-sm)',
  },
  label: {
    fontSize: 'var(--font-caption)',
    fontWeight: 600,
    marginBottom: 'var(--space-xs)',
    color: 'var(--color-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  value: {
    fontSize: 'var(--font-caption)',
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
  },
  viewport: {
    position: 'relative',
    height: '28vh',
    maxHeight: '240px',
    minHeight: '140px',
  },
  viewportSmall: {
    position: 'relative',
    height: '18vh',
    minHeight: '100px',
  },
  iconBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    border: 'none',
    background: 'var(--color-primary-light)',
    color: 'var(--color-primary)',
    fontSize: '0.9rem',
    cursor: 'pointer',
    padding: 0,
  },
}

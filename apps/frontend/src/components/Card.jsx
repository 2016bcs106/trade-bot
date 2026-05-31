export default function Card({ children, style, onClick }) {
  return (
    <div style={{ ...styles.card, ...style }} onClick={onClick}>
      {children}
    </div>
  )
}

export function CardList({ children, style }) {
  return (
    <div style={{ ...styles.list, ...style }}>
      {children}
    </div>
  )
}

const styles = {
  card: {
    background: 'var(--color-card)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    padding: 'var(--space-md) var(--space-lg)',
    marginBottom: 'var(--space-sm)',
  },
  list: {
    background: 'var(--color-card)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    overflow: 'hidden',
  },
}

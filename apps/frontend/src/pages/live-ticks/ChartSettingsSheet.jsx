import BottomSheet from '../../components/BottomSheet'
import { CHART_CONFIGS } from './constants'

export default function ChartSettingsSheet({ isOpen, onClose, visibleCharts, setVisibleCharts }) {
  return (
    <BottomSheet title="Charts" isOpen={isOpen} onClose={onClose}>
      {CHART_CONFIGS.map(({ key, label }) => (
        <div key={key} style={styles.toggleRow} onClick={() => setVisibleCharts((prev) => { const next = { ...prev, [key]: !prev[key] }; localStorage.setItem('liveTicksVisibleCharts', JSON.stringify(next)); return next })}>
          <span style={styles.toggleLabel}>{label}</span>
          <div style={{ ...styles.toggle, background: visibleCharts[key] ? 'var(--color-primary)' : 'var(--color-text-tertiary)' }}>
            <div style={{ ...styles.toggleKnob, transform: visibleCharts[key] ? 'translateX(16px)' : 'translateX(0)' }} />
          </div>
        </div>
      ))}
    </BottomSheet>
  )
}

const styles = {
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px var(--space-xl)',
    borderBottom: '1px solid var(--color-border)',
    cursor: 'pointer',
  },
  toggleLabel: {
    fontSize: 'var(--font-body)',
    fontWeight: 500,
    color: 'var(--color-text)',
  },
  toggle: {
    width: '40px',
    height: '24px',
    borderRadius: '12px',
    padding: '2px',
    transition: 'background 0.2s',
  },
  toggleKnob: {
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    background: '#fff',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
    transition: 'transform 0.2s',
  },
}

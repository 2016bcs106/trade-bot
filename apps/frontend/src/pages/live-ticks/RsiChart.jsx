import { useMemo, forwardRef } from 'react'
import { Line } from 'react-chartjs-2'
import { FIXED_LABELS } from './constants'
import { computeBsRatioRsi } from './compute-rsi'
import { syncCrosshairPlugin, rsiZonePlugin, pulsingDotPlugin } from './chart-plugins'
import useRows from './useRows'

export default forwardRef(function RsiChart({ options }, ref) {
  const rows = useRows()

  const data = useMemo(() => {
    const rsi = computeBsRatioRsi(rows)
    const rsiMapped = rows.map((r, i) => r ? rsi[i] : null)
    return {
      labels: FIXED_LABELS,
      datasets: [
        { label: 'B/S Ratio RSI', data: rsiMapped, borderColor: '#007aff', borderWidth: 1.5, pointRadius: 0, spanGaps: true, fill: false },
      ],
    }
  }, [rows])

  const latestValue = useMemo(() => {
    const d = data.datasets?.[0]?.data
    return d ? d.findLast((x) => x != null) : null
  }, [data])

  return (
    <>
      <div style={styles.labelRow}>
        <div style={styles.label}>B/S Ratio RSI (14)</div>
        {latestValue != null && (
          <span style={{ ...styles.value, color: latestValue > 70 ? 'var(--color-danger)' : latestValue < 30 ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
            {latestValue.toFixed(1)}
          </span>
        )}
      </div>
      <div style={styles.viewport}>
        <Line ref={ref} data={data} options={options} plugins={[syncCrosshairPlugin, rsiZonePlugin, pulsingDotPlugin]} />
      </div>
    </>
  )
})

const styles = {
  labelRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 'var(--space-sm)',
  },
  label: {
    fontSize: 'var(--font-caption)',
    fontWeight: 600,
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
    height: '18vh',
    minHeight: '100px',
  },
}

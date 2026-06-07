import { useMemo, forwardRef } from 'react'
import { Line } from 'react-chartjs-2'
import { FIXED_LABELS } from './constants'
import { syncCrosshairPlugin, ratioOneLinePlugin, pulsingDotPlugin } from './chart-plugins'
import useRows from './useRows'

export default forwardRef(function RatioChart({ options }, ref) {
  const rows = useRows()

  const data = useMemo(() => {
    const ratioData = rows.map((r) => {
      if (!r) return null
      const sell = r.sellQtySum || 0
      return sell > 0 ? r.buyQtySum / sell : null
    })

    return {
      labels: FIXED_LABELS,
      datasets: [{
        label: 'Buy/Sell Ratio',
        data: ratioData,
        borderColor: '#007aff',
        backgroundColor: (ctx) => {
          if (!ctx.chart?.chartArea) return 'transparent'
          const { top, bottom } = ctx.chart.chartArea
          const g = ctx.chart.ctx.createLinearGradient(0, top, 0, bottom)
          g.addColorStop(0, 'rgba(0, 122, 255, 0.12)')
          g.addColorStop(1, 'rgba(0, 122, 255, 0)')
          return g
        },
        fill: true,
        borderWidth: 1.5,
        pointRadius: 0,
        spanGaps: true,
      }],
    }
  }, [rows])

  const latestValue = useMemo(() => {
    const d = data.datasets?.[0]?.data
    return d ? d.findLast((x) => x != null) : null
  }, [data])

  return (
    <>
      <div style={styles.labelRow}>
        <div style={styles.label}>Buy / Sell Ratio</div>
        {latestValue != null && (
          <span style={{ ...styles.value, color: latestValue > 1 ? 'var(--color-success)' : latestValue < 1 ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>
            {latestValue.toFixed(3)}
          </span>
        )}
      </div>
      <div style={styles.viewport}>
        <Line ref={ref} data={data} options={options} plugins={[syncCrosshairPlugin, ratioOneLinePlugin, pulsingDotPlugin]} />
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

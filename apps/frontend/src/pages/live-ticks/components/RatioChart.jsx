import { useMemo, forwardRef } from 'react'
import { Line } from 'react-chartjs-2'
import { FIXED_LABELS } from '../utils/constants'
import { syncCrosshairPlugin, ratioOneLinePlugin, pulsingDotPlugin } from '../utils/chart-plugins'
import { chartHeaderStyles, chartStyles } from '../utils/styles'
import useRows from '../utils/useRows'

export default forwardRef(function RatioChart({ options }, ref) {
  const rows = useRows()

  const data = useMemo(() => {
    const ratioData = rows.map((r) => {
      if (!r) return null
      const total = (r.buyQtySum || 0) + (r.sellQtySum || 0)
      return total > 0 ? r.buyQtySum / total : null
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

  const valueColor = latestValue != null
    ? (latestValue > 0.5 ? 'var(--color-success)' : latestValue < 0.5 ? 'var(--color-danger)' : 'var(--color-text)')
    : 'var(--color-text)'

  return (
    <>
      <div style={chartStyles.label}>Buy Strength</div>
      <div style={chartHeaderStyles.row}>
        {latestValue != null && <span style={{ ...chartHeaderStyles.value, color: valueColor }}>{latestValue.toFixed(3)}</span>}
      </div>
      <div style={chartStyles.viewportSmall}>
        <Line ref={ref} data={data} options={options} plugins={[syncCrosshairPlugin, ratioOneLinePlugin, pulsingDotPlugin]} />
      </div>
    </>
  )
})

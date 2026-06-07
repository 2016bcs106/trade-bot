import { useMemo, forwardRef } from 'react'
import { Line } from 'react-chartjs-2'
import { FIXED_LABELS } from './constants'
import { syncCrosshairPlugin, zeroLinePlugin, pulsingDotPlugin } from './chart-plugins'
import useRows from './useRows'

export default forwardRef(function PressureChart({ options }, ref) {
  const rows = useRows()

  const data = useMemo(() => {
    const diffs = rows.map((r) => r ? (r.sellQtySum || 0) - (r.buyQtySum || 0) : null)
    const validDiffs = diffs.filter((d) => d != null)
    const maxAbs = Math.max(1, ...validDiffs.map(Math.abs))
    const tanhValues = diffs.map((d) => d != null ? Math.tanh(d / (maxAbs * 0.05)) : null)

    const sellC = 'rgba(255, 59, 48'
    const buyC = 'rgba(52, 199, 89'

    return {
      labels: FIXED_LABELS,
      datasets: [{
        label: 'tanh(S−B)',
        data: tanhValues,
        rawDiffs: diffs,
        segment: { borderColor: (ctx) => ctx.p0.parsed.y >= 0 ? '#ff3b30' : '#34c759' },
        borderColor: '#ff3b30',
        backgroundColor: (context) => {
          const chart = context.chart
          if (!chart.chartArea || !chart.scales?.y) return `${sellC}, 0.08)`
          const { top, bottom } = chart.chartArea
          const zeroY = chart.scales.y.getPixelForValue(0)
          const ratio = Math.max(0, Math.min(1, (zeroY - top) / (bottom - top)))
          const g = chart.ctx.createLinearGradient(0, top, 0, bottom)
          g.addColorStop(0, `${sellC}, 0.15)`); g.addColorStop(ratio, `${sellC}, 0)`)
          g.addColorStop(ratio, `${buyC}, 0)`); g.addColorStop(1, `${buyC}, 0.15)`)
          return g
        },
        fill: true,
        borderWidth: 1.5,
        pointRadius: 0,
        spanGaps: true,
      }],
    }
  }, [rows])

  return <Line ref={ref} data={data} options={options} plugins={[syncCrosshairPlugin, zeroLinePlugin, pulsingDotPlugin]} />
})

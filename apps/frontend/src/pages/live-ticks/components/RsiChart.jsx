import { useMemo, forwardRef } from 'react'
import { Line } from 'react-chartjs-2'
import { FIXED_LABELS } from '../utils/constants'
import { syncCrosshairPlugin, rsiZonePlugin, pulsingDotPlugin } from '../utils/chart-plugins'
import { chartHeaderStyles, chartStyles } from '../utils/styles'
import useRows from '../utils/useRows'

export default forwardRef(function RsiChart({ options }, ref) {
  const rows = useRows()

  const data = useMemo(() => {
    return {
      labels: FIXED_LABELS,
      datasets: [
        { label: 'B/S Ratio RSI', data: rows.map((r) => r ? r.rsi : null), borderColor: '#007aff', borderWidth: 1.5, pointRadius: 0, spanGaps: true, fill: false },
      ],
    }
  }, [rows])

  const latestValue = useMemo(() => {
    const d = data.datasets?.[0]?.data
    return d ? d.findLast((x) => x != null) : null
  }, [data])

  const valueColor = latestValue != null
    ? (latestValue > 70 ? 'var(--color-danger)' : latestValue < 30 ? 'var(--color-success)' : 'var(--color-text)')
    : 'var(--color-text)'

  return (
    <>
      <div style={chartStyles.label}>Buy / Sell Ratio RSI</div>
      <div style={chartHeaderStyles.row}>
        {latestValue != null && <span style={{ ...chartHeaderStyles.value, color: valueColor }}>{latestValue.toFixed(1)}</span>}
      </div>
      <div style={chartStyles.viewportSmall}>
        <Line ref={ref} data={data} options={options} plugins={[syncCrosshairPlugin, rsiZonePlugin, pulsingDotPlugin]} />
      </div>
    </>
  )
})

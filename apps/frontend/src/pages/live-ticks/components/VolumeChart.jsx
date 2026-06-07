import { useMemo, forwardRef, useState, useEffect } from 'react'
import { Line } from 'react-chartjs-2'
import moment from 'moment'
import { useApp } from '../../../context/AppContext'
import { FIXED_LABELS } from '../utils/constants'
import { syncCrosshairPlugin, pulsingDotPlugin } from '../utils/chart-plugins'
import { chartHeaderStyles, chartStyles } from '../utils/styles'
import useRows from '../utils/useRows'

export default forwardRef(function VolumeChart({ options }, ref) {
  const { marketStatus } = useApp()
  const rows = useRows()
  const isMarketOpen = marketStatus !== 'Closed'
  const [secondsElapsed, setSecondsElapsed] = useState(moment().seconds())

  useEffect(() => {
    const interval = setInterval(() => setSecondsElapsed(moment().seconds()), 1000)
    return () => clearInterval(interval)
  }, [])

  const data = useMemo(() => {
    const clampedSeconds = Math.max(secondsElapsed, 10)
    const scaleFactor = 60 / clampedSeconds

    let lastDataIdx = -1
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i]) { lastDataIdx = i; break }
    }
    let prevDataIdx = -1
    for (let i = lastDataIdx - 1; i >= 0; i--) {
      if (rows[i]) { prevDataIdx = i; break }
    }

    const prevBuy = prevDataIdx >= 0 ? rows[prevDataIdx].buyQtySum : 0
    const prevSell = prevDataIdx >= 0 ? rows[prevDataIdx].sellQtySum : 0

    const buyCompleted = rows.map((r, i) => (!r || i === lastDataIdx) ? null : r.buyQtySum)
    const sellCompleted = rows.map((r, i) => (!r || i === lastDataIdx) ? null : r.sellQtySum)

    const buyProjected = rows.map((r, i) => {
      if (i === lastDataIdx && r) return !isMarketOpen || secondsElapsed < 3 ? prevBuy : Math.round(r.buyQtySum * scaleFactor)
      if (i === prevDataIdx && rows[prevDataIdx]) return rows[prevDataIdx].buyQtySum
      return null
    })
    const sellProjected = rows.map((r, i) => {
      if (i === lastDataIdx && r) return !isMarketOpen || secondsElapsed < 3 ? prevSell : Math.round(r.sellQtySum * scaleFactor)
      if (i === prevDataIdx && rows[prevDataIdx]) return rows[prevDataIdx].sellQtySum
      return null
    })

    const mkGradient = (rgb) => (ctx) => {
      if (!ctx.chart?.chartArea) return `rgba(${rgb}, 0.05)`
      const { top, bottom } = ctx.chart.chartArea
      const g = ctx.chart.ctx.createLinearGradient(0, top, 0, bottom)
      g.addColorStop(0, `rgba(${rgb}, 0.15)`); g.addColorStop(1, `rgba(${rgb}, 0)`)
      return g
    }

    const buyColor = '#34c759', sellColor = '#ff3b30'

    return {
      labels: FIXED_LABELS,
      datasets: [
        { label: 'Buy Qty', data: buyCompleted, borderColor: buyColor, backgroundColor: mkGradient('52, 199, 89'), fill: true, spanGaps: true, skipPulsingDot: true },
        { label: 'Sell Qty', data: sellCompleted, borderColor: sellColor, backgroundColor: mkGradient('255, 59, 48'), fill: true, spanGaps: true, skipPulsingDot: true },
        { label: 'Buy (Projected)', data: buyProjected, borderColor: buyColor, borderWidth: 1.5, pointRadius: (ctx) => ctx.dataIndex === lastDataIdx ? 3 : 0, pointBackgroundColor: buyColor, pointBorderWidth: 0, spanGaps: true },
        { label: 'Sell (Projected)', data: sellProjected, borderColor: sellColor, borderWidth: 1.5, pointRadius: (ctx) => ctx.dataIndex === lastDataIdx ? 3 : 0, pointBackgroundColor: sellColor, pointBorderWidth: 0, spanGaps: true },
      ],
    }
  }, [rows, secondsElapsed, isMarketOpen])

  const latestBuy = useMemo(() => {
    const d = data.datasets?.[0]?.data
    return d ? d.findLast((x) => x != null) : null
  }, [data])

  const latestSell = useMemo(() => {
    const d = data.datasets?.[1]?.data
    return d ? d.findLast((x) => x != null) : null
  }, [data])

  return (
    <>
      <div style={chartStyles.label}>Buy vs Sell Volume</div>
      <div style={chartHeaderStyles.row}>
        {latestBuy != null && <span style={{ ...chartHeaderStyles.value, color: 'var(--color-success)' }}>{latestBuy.toLocaleString()}</span>}
        {latestBuy != null && latestSell != null && <span style={{ fontSize: 'var(--font-footnote)', color: 'var(--color-text-muted)' }}>vs</span>}
        {latestSell != null && <span style={{ ...chartHeaderStyles.value, color: 'var(--color-danger)' }}>{latestSell.toLocaleString()}</span>}
      </div>
      <div style={chartStyles.viewport}>
        <Line ref={ref} data={data} options={options} plugins={[syncCrosshairPlugin, pulsingDotPlugin]} />
      </div>
    </>
  )
})

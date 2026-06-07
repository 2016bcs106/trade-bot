import { useMemo, forwardRef } from 'react'
import { Line } from 'react-chartjs-2'
import { useApp } from '../../../context/AppContext'
import { FIXED_LABELS } from '../utils/constants'
import { syncCrosshairPlugin, pulsingDotPlugin } from '../utils/chart-plugins'
import { chartHeaderStyles, chartStyles } from '../utils/styles'
import useRows from '../utils/useRows'

export default forwardRef(function PriceChart({ options }, ref) {
  const { rowsByMinute } = useApp()
  const rows = useRows()

  const latestPrice = useMemo(() => {
    const minutes = Object.values(rowsByMinute)
    if (minutes.length === 0) return null
    const sorted = minutes.sort((a, b) => String(a.minute).localeCompare(String(b.minute)))
    return sorted[sorted.length - 1].close
  }, [rowsByMinute])

  const openPrice = useMemo(() => {
    const minutes = Object.values(rowsByMinute)
    if (minutes.length === 0) return null
    const sorted = minutes.sort((a, b) => String(a.minute).localeCompare(String(b.minute)))
    for (const r of sorted) {
      const time = String(r.minute).split('T')[1]?.slice(0, 5) || ''
      if (time >= '09:00') return r.close
    }
    return sorted[0].close
  }, [rowsByMinute])

  const data = useMemo(() => {
    const isPositive = openPrice != null && latestPrice != null && latestPrice >= openPrice
    const lineColor = openPrice == null ? '#007aff' : (isPositive ? '#34c759' : '#ff3b30')
    const fillRgb = isPositive ? '52, 199, 89' : '255, 59, 48'

    const bbPeriod = 20
    const multiplier = 2
    const closes = rows.map((r) => r ? r.close : null)
    const sma = new Array(closes.length).fill(null)
    const upper = new Array(closes.length).fill(null)
    const lower = new Array(closes.length).fill(null)

    const window = []
    for (let i = 0; i < closes.length; i++) {
      if (closes[i] != null) window.push(closes[i])
      if (window.length > bbPeriod) window.shift()
      if (window.length === bbPeriod) {
        const mean = window.reduce((a, b) => a + b, 0) / bbPeriod
        const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / bbPeriod
        const std = Math.sqrt(variance)
        sma[i] = mean
        upper[i] = mean + multiplier * std
        lower[i] = mean - multiplier * std
      }
    }

    const bandColor = 'rgba(0, 122, 255, 0.3)'
    const smaColor = 'rgba(0, 122, 255, 0.5)'

    return {
      labels: FIXED_LABELS,
      datasets: [
        { label: 'Upper Band', data: upper, borderColor: bandColor, borderWidth: 0.5, borderDash: [3, 3], pointRadius: 0, pointHoverRadius: 0, fill: false, spanGaps: true, skipPulsingDot: true },
        { label: 'Lower Band', data: lower, borderColor: bandColor, borderWidth: 0.5, borderDash: [3, 3], pointRadius: 0, pointHoverRadius: 0, fill: '-1', backgroundColor: 'rgba(0, 122, 255, 0.04)', spanGaps: true, skipPulsingDot: true },
        { label: 'SMA (20)', data: sma, borderColor: smaColor, borderWidth: 1, borderDash: [2, 2], pointRadius: 0, pointHoverRadius: 0, fill: false, spanGaps: true, skipPulsingDot: true },
        {
          label: 'Close Price',
          data: closes,
          borderColor: lineColor,
          backgroundColor: (ctx) => {
            if (!ctx.chart) return 'transparent'
            const { top, bottom } = ctx.chart.chartArea || { top: 0, bottom: ctx.chart.height }
            const gradient = ctx.chart.ctx.createLinearGradient(0, top, 0, bottom)
            gradient.addColorStop(0, `rgba(${fillRgb}, 0.2)`)
            gradient.addColorStop(1, `rgba(${fillRgb}, 0)`)
            return gradient
          },
          fill: true,
          spanGaps: true,
        },
      ],
    }
  }, [rows, openPrice, latestPrice])

  const priceChange = openPrice != null && latestPrice != null ? latestPrice - openPrice : null
  const isPricePositive = priceChange != null && priceChange >= 0

  return (
    <>
      <div style={chartStyles.label}>Price</div>
      <div style={chartHeaderStyles.row}>
        {latestPrice != null && <span style={chartHeaderStyles.value}>{latestPrice.toFixed(2)}</span>}
        {priceChange != null && (
          <span style={{ ...chartHeaderStyles.change, color: isPricePositive ? 'var(--color-success)' : 'var(--color-danger)' }}>
            {isPricePositive ? '+' : ''}{priceChange.toFixed(2)}
          </span>
        )}
      </div>
      <div style={chartStyles.viewport}>
        <Line ref={ref} data={data} options={options} plugins={[syncCrosshairPlugin, pulsingDotPlugin]} />
      </div>
    </>
  )
})

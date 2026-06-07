import { useMemo, forwardRef } from 'react'
import { Line } from 'react-chartjs-2'
import { useApp } from '../../../context/AppContext'
import { FIXED_LABELS } from '../utils/constants'
import { syncCrosshairPlugin, pulsingDotPlugin } from '../utils/chart-plugins'
import { chartHeaderStyles, chartStyles } from '../utils/styles'
import { getSignalSource } from '../../Settings'
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

    const useBackend = getSignalSource() === 'backend'
    let buySignals, sellSignals, exitSignals, netProfit = 0

    if (useBackend) {
      buySignals = rows.map((r) => r?.signal === 'buy' ? r.close : null)
      sellSignals = rows.map((r) => r?.signal === 'sell' ? r.close : null)
      exitSignals = rows.map((r) => r?.signal === 'exit' ? r.close : null)

      let position = null, entryPrice = null
      for (let i = 0; i < rows.length; i++) {
        if (!rows[i]) continue
        const sig = rows[i].signal
        if (sig === 'buy') { position = 'long'; entryPrice = rows[i].close }
        else if (sig === 'sell') { position = 'short'; entryPrice = rows[i].close }
        else if (sig === 'exit' && entryPrice != null) {
          netProfit += position === 'long' ? rows[i].close - entryPrice : entryPrice - rows[i].close
          position = null; entryPrice = null
        }
      }
      if (position === 'long' && entryPrice != null && latestPrice != null) netProfit += latestPrice - entryPrice
      else if (position === 'short' && entryPrice != null && latestPrice != null) netProfit += entryPrice - latestPrice
    } else {
      buySignals = new Array(closes.length).fill(null)
      sellSignals = new Array(closes.length).fill(null)
      exitSignals = new Array(closes.length).fill(null)
      let position = null, entryPrice = null

      for (let i = 0; i < closes.length; i++) {
        if (closes[i] == null) continue
        const rsi = rows[i]?.rsi

        if (position === 'long' && sma[i] != null && closes[i] < sma[i]) {
          exitSignals[i] = closes[i]
          netProfit += closes[i] - entryPrice
          position = null
          entryPrice = null
        } else if (position === 'short' && sma[i] != null && closes[i] > sma[i]) {
          exitSignals[i] = closes[i]
          netProfit += entryPrice - closes[i]
          position = null
          entryPrice = null
        }

        if (position != null || rsi == null) continue

        if (rsi > 65 && (upper[i] == null || closes[i] <= upper[i])) {
          if (sma[i] == null || closes[i] >= sma[i]) {
            buySignals[i] = closes[i]
            position = 'long'
            entryPrice = closes[i]
          }
        } else if (rsi < 35 && (lower[i] == null || closes[i] >= lower[i])) {
          if (sma[i] == null || closes[i] <= sma[i]) {
            sellSignals[i] = closes[i]
            position = 'short'
            entryPrice = closes[i]
          }
        }
      }

      if (position === 'long' && entryPrice != null && latestPrice != null) netProfit += latestPrice - entryPrice
      else if (position === 'short' && entryPrice != null && latestPrice != null) netProfit += entryPrice - latestPrice
    }

    return { netProfit, chartData: {
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
        {
          label: 'Buy',
          data: buySignals,
          borderColor: '#34c759',
          backgroundColor: '#34c759',
          pointRadius: (ctx) => buySignals[ctx.dataIndex] != null ? 5 : 0,
          pointHoverRadius: (ctx) => buySignals[ctx.dataIndex] != null ? 6 : 0,
          pointStyle: 'triangle',
          showLine: false,
          skipPulsingDot: true,
        },
        {
          label: 'Sell',
          data: sellSignals,
          borderColor: '#ff3b30',
          backgroundColor: '#ff3b30',
          pointRadius: (ctx) => sellSignals[ctx.dataIndex] != null ? 5 : 0,
          pointHoverRadius: (ctx) => sellSignals[ctx.dataIndex] != null ? 6 : 0,
          pointStyle: 'triangle',
          pointRotation: 180,
          showLine: false,
          skipPulsingDot: true,
        },
        {
          label: 'Exit',
          data: exitSignals,
          borderColor: '#ff9500',
          backgroundColor: '#ff9500',
          pointRadius: (ctx) => exitSignals[ctx.dataIndex] != null ? 4 : 0,
          pointHoverRadius: (ctx) => exitSignals[ctx.dataIndex] != null ? 5 : 0,
          pointStyle: 'circle',
          showLine: false,
          skipPulsingDot: true,
        },
      ],
    }}
  }, [rows, openPrice, latestPrice])

  const priceChange = openPrice != null && latestPrice != null ? latestPrice - openPrice : null
  const isPricePositive = priceChange != null && priceChange >= 0

  return (
    <>
      <div style={chartStyles.labelRow}>
        <div style={chartStyles.label}>Price</div>
        {data.netProfit !== 0 && (
          <span style={{ ...chartHeaderStyles.change, color: data.netProfit > 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
            P&L: {data.netProfit > 0 ? '+' : ''}{data.netProfit.toFixed(2)}
          </span>
        )}
      </div>
      <div style={chartHeaderStyles.row}>
        {latestPrice != null && <span style={chartHeaderStyles.value}>{latestPrice.toFixed(2)}</span>}
        {priceChange != null && (
          <span style={{ ...chartHeaderStyles.change, color: isPricePositive ? 'var(--color-success)' : 'var(--color-danger)' }}>
            {isPricePositive ? '+' : ''}{priceChange.toFixed(2)}
          </span>
        )}
      </div>
      <div style={chartStyles.viewport}>
        <Line ref={ref} data={data.chartData} options={options} plugins={[syncCrosshairPlugin, pulsingDotPlugin]} />
      </div>
    </>
  )
})

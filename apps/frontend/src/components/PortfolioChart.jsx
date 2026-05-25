import { useState, useRef } from 'react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
} from 'chart.js'
import { colors, merge } from '../utils/styles'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler)

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 300 },
  plugins: {
    legend: { display: false },
    tooltip: { enabled: false },
  },
  scales: {
    x: {
      display: true,
      offset: false,
      grid: { display: false },
      border: { display: false },
      ticks: {
        color: colors.muted,
        font: { size: 10 },
        maxTicksLimit: 7,
        padding: 0,
        callback: function (val, index) {
          const label = this.getLabelForValue(index)
          return label?.endsWith(':00') ? label : null
        },
      },
      afterFit: (axis) => { axis.paddingLeft = 0; axis.paddingRight = 0 },
    },
    y: {
      display: false,
      afterFit: (axis) => { axis.paddingTop = 0; axis.paddingBottom = 0 },
    },
  },
  layout: {
    padding: { left: 0, right: 0, top: 0, bottom: 0 },
  },
}

const SERIES = {
  close: { label: 'Close', color: colors.green, fillColor: '34, 197, 94' },
  fastSma: { label: 'Fast SMA', color: colors.blue, fillColor: null },
  slowSma: { label: 'Slow SMA', color: colors.amber, fillColor: null },
}

const styles = {
  container: { width: '100%' },
  stockInfo: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '1.5rem 1rem 0.5rem',
  },
  icon: {
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    background: colors.light,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '20px',
    fontWeight: '700',
    color: colors.dark,
    marginBottom: '0.5rem',
    border: `1px solid ${colors.border}`,
  },
  name: { fontSize: '0.875rem', color: colors.secondary, marginBottom: '0.25rem' },
  price: { fontSize: '2rem', fontWeight: '700', color: colors.dark, lineHeight: 1.2 },
  change: { fontSize: '0.875rem', fontWeight: '600', marginTop: '0.25rem' },
  chart: { height: '25vh', width: '100%', padding: '0 1rem' },
  labels: {
    display: 'flex',
    justifyContent: 'center',
    gap: '0.75rem',
    padding: '0.5rem 1rem',
  },
  label: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.375rem',
    fontSize: '0.75rem',
    fontWeight: '500',
    cursor: 'pointer',
    padding: '0.25rem 0.75rem',
    borderRadius: '999px',
    border: `1px solid ${colors.border}`,
    background: colors.white,
    userSelect: 'none',
    transition: 'opacity 0.2s',
  },
  labelDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
}

/** Generate hourly market labels (9:15 to 15:30) as placeholders when no ticks */
function generateMarketLabels() {
  const labels = []
  for (let h = 9; h <= 15; h++) {
    const start = h === 9 ? 15 : 0
    const end = h === 15 ? 30 : 59
    for (let m = start; m <= end; m += 15) {
      labels.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    }
  }
  return labels
}

export default function PortfolioChart({ name = 'Select Stock', ticker = '?', ticks = [], signals = [], predictedHigh = null, predictedLow = null, predictedClose = null }) {
  const [visible, setVisible] = useState({ close: true, fastSma: false, slowSma: false })
  const chartRef = useRef(null)

  // Build signal map from signals prop
  const signalMap = {}
  signals.forEach((s) => { signalMap[s.time] = s.signal })

  // Extract time labels and data from ticks
  const timeLabels = ticks.map((t) => t.time)
  const closePrices = ticks.map((t) => t.close)
  const fastSmaValues = ticks.map((t) => t.fastSma ?? null)
  const slowSmaValues = ticks.map((t) => t.slowSma ?? null)

  const openPrice = closePrices.length > 0 ? closePrices[0] : 0
  const currentPrice = closePrices.length > 0 ? closePrices[closePrices.length - 1] : 0
  const change = currentPrice - openPrice
  const changePercent = openPrice !== 0 ? (change / openPrice) * 100 : 0
  const isPositive = change >= 0
  const changeColor = isPositive ? colors.green : colors.red

  function toggleSeries(key) {
    setVisible((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function makeDataset(key) {
    const series = SERIES[key]
    let data
    if (key === 'close') data = closePrices
    else if (key === 'fastSma') data = fastSmaValues
    else data = slowSmaValues

    const isClose = key === 'close'
    return {
      label: series.label,
      data,
      borderColor: isClose ? (isPositive ? colors.green : colors.red) : series.color,
      backgroundColor: isClose
        ? (ctx) => {
            if (!ctx.chart) return 'transparent'
            const gradient = ctx.chart.ctx.createLinearGradient(0, 0, 0, ctx.chart.height)
            const rgb = isPositive ? '34, 197, 94' : '239, 68, 68'
            gradient.addColorStop(0, `rgba(${rgb}, 0.3)`)
            gradient.addColorStop(1, `rgba(${rgb}, 0.02)`)
            return gradient
          }
        : 'transparent',
      borderWidth: isClose ? 2 : 1.5,
      borderDash: [],
      pointRadius: (ctx) => signalMap[timeLabels[ctx.dataIndex]] ? 5 : 0,
      pointHoverRadius: (ctx) => signalMap[timeLabels[ctx.dataIndex]] ? 7 : 0,
      pointBackgroundColor: (ctx) => {
        const sig = signalMap[timeLabels[ctx.dataIndex]]
        if (!sig) return 'transparent'
        if (isClose) return sig === 'BUY' ? colors.green : colors.red
        return series.color
      },
      pointBorderColor: (ctx) => {
        const sig = signalMap[timeLabels[ctx.dataIndex]]
        if (!sig) return 'transparent'
        return 'white'
      },
      pointBorderWidth: (ctx) => signalMap[timeLabels[ctx.dataIndex]] ? 2 : 0,
      tension: 0.4,
      fill: isClose,
      spanGaps: true,
      hidden: !visible[key],
    }
  }

  // If no ticks but we have predictions, generate placeholder time labels (market hours)
  const hasPrediction = predictedHigh !== null || predictedLow !== null || predictedClose !== null
  const effectiveLabels = timeLabels.length > 0
    ? timeLabels
    : (hasPrediction ? generateMarketLabels() : [])

  // Build prediction line datasets (horizontal dotted lines)
  const predictionDatasets = []
  if (predictedHigh !== null && effectiveLabels.length > 0) {
    predictionDatasets.push({
      label: 'Pred High',
      data: effectiveLabels.map(() => predictedHigh),
      borderColor: 'rgba(34, 197, 94, 0.6)',
      borderWidth: 1.5,
      borderDash: [6, 4],
      pointRadius: 0,
      fill: false,
      tension: 0,
      spanGaps: true,
      hidden: false,
    })
  }
  if (predictedLow !== null && effectiveLabels.length > 0) {
    predictionDatasets.push({
      label: 'Pred Low',
      data: effectiveLabels.map(() => predictedLow),
      borderColor: 'rgba(239, 68, 68, 0.6)',
      borderWidth: 1.5,
      borderDash: [6, 4],
      pointRadius: 0,
      fill: false,
      tension: 0,
      spanGaps: true,
      hidden: false,
    })
  }
  if (predictedClose !== null && effectiveLabels.length > 0) {
    predictionDatasets.push({
      label: 'Pred Close',
      data: effectiveLabels.map(() => predictedClose),
      borderColor: 'rgba(59, 130, 246, 0.6)',
      borderWidth: 1.5,
      borderDash: [6, 4],
      pointRadius: 0,
      fill: false,
      tension: 0,
      spanGaps: true,
      hidden: false,
    })
  }

  const chartData = {
    labels: effectiveLabels,
    datasets: [...Object.keys(SERIES).map(makeDataset), ...predictionDatasets],
  }

  return (
    <div style={styles.container}>
      <div style={styles.stockInfo}>
        <div style={styles.icon}>{ticker.charAt(0)}</div>
        <div style={styles.name}>{name}</div>
        <div style={styles.price}>{currentPrice.toFixed(2)}</div>
        <div style={merge(styles.change, { color: changeColor })}>
          {isPositive ? '+' : ''}{change.toFixed(2)} ({changePercent.toFixed(2)}%)
        </div>
      </div>
      <div style={styles.chart}>
        <Line ref={chartRef} data={chartData} options={chartOptions} />
      </div>
      <div style={styles.labels}>
        {Object.entries(SERIES).map(([key, series]) => (
          <div
            key={key}
            style={merge(styles.label, {
              opacity: visible[key] ? 1 : 0.4,
              borderColor: visible[key] ? series.color : colors.border,
            })}
            onClick={() => toggleSeries(key)}
          >
            <span style={merge(styles.labelDot, { background: series.color })} />
            {series.label}
          </div>
        ))}
      </div>
    </div>
  )
}

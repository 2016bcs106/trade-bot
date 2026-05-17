import { useState, useEffect, useRef, useCallback } from 'react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
} from 'chart.js'
import { merge } from '../utils/styles'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler)

function generateTimeSlots() {
  const slots = []
  for (let h = 9; h <= 15; h++) {
    const maxMin = h === 15 ? 30 : 59
    for (let m = 0; m <= maxMin; m++) {
      slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    }
  }
  return slots
}

const TIME_SLOTS = generateTimeSlots()

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
        color: '#94a3b8',
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
  close: { label: 'Close', color: '#22c55e', fillColor: '34, 197, 94' },
  fastSma: { label: 'Fast SMA', color: '#3b82f6', fillColor: null },
  slowSma: { label: 'Slow SMA', color: '#f59e0b', fillColor: null },
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
    background: '#f1f5f9',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '20px',
    fontWeight: '700',
    color: '#334155',
    marginBottom: '0.5rem',
    border: '1px solid #e2e8f0',
  },
  name: { fontSize: '0.875rem', color: '#64748b', marginBottom: '0.25rem' },
  price: { fontSize: '2rem', fontWeight: '700', color: '#1e293b', lineHeight: 1.2 },
  change: { fontSize: '0.875rem', fontWeight: '600', marginTop: '0.25rem' },
  chart: { height: '25vh', width: '100%' },
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
    border: '1px solid #e2e8f0',
    background: 'white',
    userSelect: 'none',
    transition: 'opacity 0.2s',
  },
  labelDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
}

export default function PortfolioChart({ name = 'Adani Enterprises', ticker = 'AE', openPrice = 2712.90, signals = [] }) {
  const [dataMap, setDataMap] = useState({ close: {}, fastSma: {}, slowSma: {} })
  const [visible, setVisible] = useState({ close: true, fastSma: false, slowSma: false })

  const signalMap = {}
  signals.forEach((s) => { signalMap[s.time] = s.signal })
  const chartRef = useRef(null)

  const closePrices = TIME_SLOTS.map((t) => dataMap.close[t] ?? null)
  const filledPrices = closePrices.filter((p) => p !== null)
  const currentPrice = filledPrices.length > 0 ? filledPrices[filledPrices.length - 1] : openPrice
  const change = currentPrice - openPrice
  const changePercent = (change / openPrice) * 100
  const isPositive = change >= 0
  const changeColor = isPositive ? '#22c55e' : '#ef4444'

  const addTick = useCallback((time, close, fastSma = null, slowSma = null) => {
    setDataMap((prev) => ({
      close: { ...prev.close, [time]: close },
      fastSma: fastSma !== null ? { ...prev.fastSma, [time]: fastSma } : prev.fastSma,
      slowSma: slowSma !== null ? { ...prev.slowSma, [time]: slowSma } : prev.slowSma,
    }))
  }, [])

  // Simulate real-time data for demo
  useEffect(() => {
    let p = openPrice
    let fastSma = openPrice
    let slowSma = openPrice
    let minute = 0
    const interval = setInterval(() => {
      if (minute >= TIME_SLOTS.length) { clearInterval(interval); return }
      p += (Math.random() - 0.48) * 5
      fastSma += (p - fastSma) * 0.3
      slowSma += (p - slowSma) * 0.1
      addTick(
        TIME_SLOTS[minute],
        parseFloat(p.toFixed(2)),
        parseFloat(fastSma.toFixed(2)),
        parseFloat(slowSma.toFixed(2)),
      )
      minute++
    }, 1000)
    return () => clearInterval(interval)
  }, [openPrice, addTick])

  useEffect(() => {
    window.__chartAddTick = addTick
    return () => { delete window.__chartAddTick }
  }, [addTick])

  function toggleSeries(key) {
    setVisible((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function makeDataset(key) {
    const series = SERIES[key]
    const data = TIME_SLOTS.map((t) => dataMap[key][t] ?? null)
    const isClose = key === 'close'
    return {
      label: series.label,
      data,
      borderColor: isClose ? (isPositive ? '#22c55e' : '#ef4444') : series.color,
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
      pointRadius: (ctx) => signalMap[TIME_SLOTS[ctx.dataIndex]] ? 5 : 0,
      pointHoverRadius: (ctx) => signalMap[TIME_SLOTS[ctx.dataIndex]] ? 7 : 0,
      pointBackgroundColor: (ctx) => {
        const sig = signalMap[TIME_SLOTS[ctx.dataIndex]]
        if (!sig) return 'transparent'
        if (isClose) return sig === 'BUY' ? '#22c55e' : '#ef4444'
        return series.color
      },
      pointBorderColor: (ctx) => {
        const sig = signalMap[TIME_SLOTS[ctx.dataIndex]]
        if (!sig) return 'transparent'
        return 'white'
      },
      pointBorderWidth: (ctx) => signalMap[TIME_SLOTS[ctx.dataIndex]] ? 2 : 0,
      tension: 0.4,
      fill: isClose,
      spanGaps: true,
      hidden: !visible[key],
    }
  }

  const chartData = {
    labels: TIME_SLOTS,
    datasets: Object.keys(SERIES).map(makeDataset),
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
              borderColor: visible[key] ? series.color : '#e2e8f0',
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

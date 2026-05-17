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

// Fixed market hours: 9:00 to 15:30, one slot per minute
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
}

export default function PortfolioChart({ name = 'Adani Enterprises', ticker = 'AE', openPrice = 2712.90 }) {
  const [priceMap, setPriceMap] = useState({})
  const chartRef = useRef(null)

  const prices = TIME_SLOTS.map((t) => priceMap[t] ?? null)
  const filledPrices = prices.filter((p) => p !== null)
  const currentPrice = filledPrices.length > 0 ? filledPrices[filledPrices.length - 1] : openPrice
  const change = currentPrice - openPrice
  const changePercent = (change / openPrice) * 100
  const isPositive = change >= 0
  const changeColor = isPositive ? '#22c55e' : '#ef4444'
  const lineColor = isPositive ? '#22c55e' : '#ef4444'

  const addTick = useCallback((price, time) => {
    // time should be "HH:MM" format
    setPriceMap((prev) => ({ ...prev, [time]: price }))
  }, [])

  // Simulate real-time data for demo (remove when integrating backend)
  useEffect(() => {
    let p = openPrice
    let minute = 0
    const interval = setInterval(() => {
      if (minute >= TIME_SLOTS.length) {
        clearInterval(interval)
        return
      }
      p += (Math.random() - 0.48) * 5
      addTick(parseFloat(p.toFixed(2)), TIME_SLOTS[minute])
      minute++
    }, 1000)
    return () => clearInterval(interval)
  }, [openPrice, addTick])

  // Expose addTick for external use
  useEffect(() => {
    window.__chartAddTick = addTick
    return () => { delete window.__chartAddTick }
  }, [addTick])

  const chartData = {
    labels: TIME_SLOTS,
    datasets: [{
      data: prices,
      borderColor: lineColor,
      backgroundColor: (ctx) => {
        if (!ctx.chart) return 'transparent'
        const gradient = ctx.chart.ctx.createLinearGradient(0, 0, 0, ctx.chart.height)
        const rgb = isPositive ? '34, 197, 94' : '239, 68, 68'
        gradient.addColorStop(0, `rgba(${rgb}, 0.3)`)
        gradient.addColorStop(1, `rgba(${rgb}, 0.02)`)
        return gradient
      },
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 0,
      tension: 0.4,
      fill: true,
      spanGaps: true,
    }],
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
    </div>
  )
}

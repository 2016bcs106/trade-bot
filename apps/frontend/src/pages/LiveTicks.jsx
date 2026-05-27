import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { Line } from 'react-chartjs-2'

const WS_URL = import.meta.env.VITE_LIVE_TICKS_WS_URL || 'wss://ec2-13-235-76-118.ap-south-1.compute.amazonaws.com:8081/live-ticks'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend)

function getTodayIstDate() {
  const now = new Date()
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const yyyy = ist.getFullYear()
  const mm = String(ist.getMonth() + 1).padStart(2, '0')
  const dd = String(ist.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function isCurrentIstDayMinute(minute) {
  if (!minute) return false
  return String(minute).slice(0, 10) === getTodayIstDate()
}

const syncCrosshairPlugin = {
  id: 'syncCrosshair',
  afterDatasetsDraw(chart) {
    const active = chart.getActiveElements()
    if (!active.length) return

    const {
      ctx,
      chartArea: { top, bottom, left, right },
    } = chart
    const { x, y } = active[0].element

    ctx.save()
    ctx.beginPath()
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)'
    ctx.setLineDash([4, 4])
    ctx.moveTo(x, top)
    ctx.lineTo(x, bottom)
    ctx.moveTo(left, y)
    ctx.lineTo(right, y)
    ctx.stroke()
    ctx.restore()
  },
}

const styles = {
  wrap: { padding: '1rem', paddingBottom: '5rem' },
  title: { margin: 0, marginBottom: '0.5rem' },
  status: { marginBottom: '1rem', fontSize: '0.9rem', color: 'var(--pm-text-muted)' },
  chartCard: {
    position: 'relative',
    background: 'var(--pm-card-bg)',
    border: '1px solid var(--pm-border)',
    borderRadius: '8px',
    padding: '0.75rem',
    marginBottom: '1rem',
  },
  chartViewport: {
    position: 'relative',
    height: '32vh',
    maxHeight: '280px',
    minHeight: '180px',
  },
  chartTitle: { margin: '0 0 0.5rem 0', fontSize: '0.95rem' },
}

const baseChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: { legend: { display: true } },
  elements: { point: { radius: 0 }, line: { borderWidth: 1.5 } },
  scales: {
    x: {
      ticks: { autoSkip: true, maxTicksLimit: 10 },
    },
  },
}

const quantityChartOptions = {
  ...baseChartOptions,
  scales: {
    ...baseChartOptions.scales,
    ratioAxis: {
      position: 'right',
      grid: { drawOnChartArea: false },
    },
  },
}

function CircularMinuteProgress() {
  const [seconds, setSeconds] = useState(new Date().getSeconds())

  useEffect(() => {
    const interval = setInterval(() => {
      setSeconds(new Date().getSeconds())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const size = 40
  const strokeWidth = 4
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const progress = seconds / 60
  const dashOffset = circumference * (1 - progress)

  return (
    <div style={{
      position: 'absolute',
      top: '4px',
      right: '4px',
      zIndex: 10,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="rgba(0,0,0,0.4)"
          stroke="rgba(255,255,255,0.15)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#a855f7"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
        />
      </svg>
      <span style={{
        position: 'absolute',
        fontSize: '11px',
        fontWeight: 600,
        color: '#e2e8f0',
        userSelect: 'none',
      }}>
        {seconds}
      </span>
    </div>
  )
}

export default function LiveTicks() {
  const [status, setStatus] = useState('connecting')
  const [stocks, setStocks] = useState([])
  const [selectedInstrumentKey, setSelectedInstrumentKey] = useState('')
  const [rowsByMinute, setRowsByMinute] = useState({})
  const [secondsElapsed, setSecondsElapsed] = useState(new Date().getSeconds())
  const wsRef = useRef(null)
  const priceChartRef = useRef(null)
  const qtyChartRef = useRef(null)

  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsElapsed(new Date().getSeconds())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => setStatus('connected')
    ws.onclose = () => setStatus('disconnected')
    ws.onerror = () => setStatus('error')

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)

        if (msg.type === 'stock_list' && Array.isArray(msg.data)) {
          const stockList = msg.data
          setStocks(stockList)

          if (stockList.length > 0) {
            const firstKey = stockList[0].instrumentKey
            setSelectedInstrumentKey(firstKey)
            ws.send(JSON.stringify({
              type: 'subscribe',
              data: { instrumentKey: firstKey },
            }))
          }
          return
        }

        if (msg.type === 'snapshot' && Array.isArray(msg.data)) {
          const next = {}
          for (const item of msg.data) {
            if (item?.minute && isCurrentIstDayMinute(item.minute)) next[item.minute] = item
          }
          setRowsByMinute(next)
          return
        }

        if (msg.type === 'minute_update' && msg.data?.minute) {
          if (!isCurrentIstDayMinute(msg.data.minute)) return
          setRowsByMinute((prev) => ({ ...prev, [msg.data.minute]: msg.data }))
          return
        }

        if (msg.type === 'day_reset') {
          setRowsByMinute({})
        }
      } catch {
        // ignore malformed payloads
      }
    }

    return () => {
      if (wsRef.current) wsRef.current.close()
    }
  }, [])

  const handleStockChange = (event) => {
    const instrumentKey = event.target.value
    setSelectedInstrumentKey(instrumentKey)
    setRowsByMinute({})

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    wsRef.current.send(JSON.stringify({
      type: 'subscribe',
      data: { instrumentKey },
    }))
  }

  const rows = useMemo(
    () => Object.values(rowsByMinute).sort((a, b) => String(a.minute).localeCompare(String(b.minute))),
    [rowsByMinute],
  )

  const labels = useMemo(
    () => rows.map((r) => String(r.minute).split('T')[1]?.slice(0, 5) || String(r.minute)),
    [rows],
  )

  const priceChartData = useMemo(() => ({
    labels,
    datasets: [
      {
        label: 'Close Price',
        data: rows.map((r) => r.close),
        borderColor: '#3b82f6',
      },
    ],
  }), [labels, rows])

  const qtyChartData = useMemo(() => {
    const clampedSeconds = Math.max(secondsElapsed, 5)
    const scaleFactor = 60 / clampedSeconds

    // Extrapolated data: null for all points except the last two (to draw a connecting line)
    const extraBuyData = rows.map((r, i) => {
      if (i === rows.length - 1) return Math.round(r.buyQtySum * scaleFactor)
      if (i === rows.length - 2) return r.buyQtySum // anchor from previous actual point
      return null
    })
    const extraSellData = rows.map((r, i) => {
      if (i === rows.length - 1) return Math.round(r.sellQtySum * scaleFactor)
      if (i === rows.length - 2) return r.sellQtySum // anchor from previous actual point
      return null
    })

    return {
      labels,
      datasets: [
        {
          label: 'Buy Qty Sum',
          data: rows.map((r) => r.buyQtySum),
          borderColor: '#22c55e',
        },
        {
          label: 'Sell Qty Sum',
          data: rows.map((r) => r.sellQtySum),
          borderColor: '#ef4444',
        },
        {
          label: 'Buy Qty (Projected)',
          data: extraBuyData,
          borderColor: '#22c55e',
          borderDash: [5, 5],
          borderWidth: 2,
          pointRadius: 3,
          pointStyle: 'circle',
          spanGaps: false,
        },
        {
          label: 'Sell Qty (Projected)',
          data: extraSellData,
          borderColor: '#ef4444',
          borderDash: [5, 5],
          borderWidth: 2,
          pointRadius: 3,
          pointStyle: 'circle',
          spanGaps: false,
        },
        {
          label: 'Buy/Sell Ratio',
          data: rows.map((r) => r.buySellRatio),
          borderColor: '#a855f7',
          yAxisID: 'ratioAxis',
          hidden: true,
        },
      ],
    }
  }, [labels, rows, secondsElapsed])

  const latestPrice = rows.length > 0 ? rows[rows.length - 1].close : null

  const syncChartsAtIndex = (sourceChart, index) => {
    const charts = [priceChartRef.current, qtyChartRef.current].filter(Boolean)
    const sourceLabel = sourceChart?.data?.labels?.[index]

    charts.forEach((target) => {
      if (sourceLabel == null) {
        target.setActiveElements([])
        target.tooltip?.setActiveElements([], { x: 0, y: 0 })
        target.update('none')
        return
      }

      const mappedIndex = target.data.labels.indexOf(sourceLabel)
      if (mappedIndex >= 0) {
        const active = [{ datasetIndex: 0, index: mappedIndex }]
        target.setActiveElements(active)
        target.tooltip?.setActiveElements(active, { x: 0, y: 0 })
      } else {
        target.setActiveElements([])
        target.tooltip?.setActiveElements([], { x: 0, y: 0 })
      }
      target.update('none')
    })
  }

  const clearSyncedHover = () => {
    ;[priceChartRef.current, qtyChartRef.current].filter(Boolean).forEach((chart) => {
      chart.setActiveElements([])
      chart.tooltip?.setActiveElements([], { x: 0, y: 0 })
      chart.update('none')
    })
  }

  const buildOptions = (base) => ({
    ...base,
    plugins: {
      ...base.plugins,
      syncCrosshair: true,
    },
    onHover: (event, elements, chart) => {
      if (!elements.length) {
        clearSyncedHover()
        return
      }
      syncChartsAtIndex(chart, elements[0].index)
    },
  })

  return (
    <div style={styles.wrap}>
      <h2 style={styles.title}>Live Minute Aggregates</h2>
      <div style={styles.status}>WebSocket: <strong>{status}</strong> ({WS_URL})</div>
      <div style={{ marginBottom: '0.75rem' }}>
        <select value={selectedInstrumentKey} onChange={handleStockChange} style={{ padding: '0.45rem', minWidth: '260px' }}>
          {stocks.map((stock) => (
            <option key={stock.instrumentKey} value={stock.instrumentKey}>
              {stock.symbol} — {stock.displayName}
            </option>
          ))}
        </select>
      </div>

      <div style={styles.chartCard}>
        <h3 style={styles.chartTitle}>
          Live Market Price (Close)
          {latestPrice != null ? ` — Live: ${latestPrice}` : ''}
        </h3>
        <div style={styles.chartViewport}>
          <Line ref={priceChartRef} data={priceChartData} options={buildOptions(baseChartOptions)} plugins={[syncCrosshairPlugin]} />
        </div>
      </div>

      <div style={styles.chartCard}>
        <CircularMinuteProgress />
        <h3 style={styles.chartTitle}>Aggregated Buy vs Sell Quantities</h3>
        <div style={styles.chartViewport}>
          <Line ref={qtyChartRef} data={qtyChartData} options={buildOptions(quantityChartOptions)} plugins={[syncCrosshairPlugin]} />
        </div>
      </div>
    </div>
  )
}
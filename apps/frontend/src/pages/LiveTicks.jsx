import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlugCircleXmark } from '@fortawesome/free-solid-svg-icons'

const WS_URL = import.meta.env.VITE_LIVE_TICKS_WS_URL || 'wss://trade-bot-ws.duckdns.org:8081/live-ticks'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Title, Tooltip, Legend)

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

const pulsingDotPlugin = {
  id: 'pulsingDot',
  afterDatasetsDraw(chart) {
    const { ctx } = chart
    const time = Date.now() / 1000
    const scale = 1 + 0.4 * Math.sin(time * 6)
    const alpha = 0.6 + 0.4 * Math.sin(time * 6)

    chart.data.datasets.forEach((dataset, datasetIndex) => {
      if (dataset.skipPulsingDot) return
      const meta = chart.getDatasetMeta(datasetIndex)
      if (!meta.visible) return
      // Find last non-null point
      let lastPoint = null
      for (let i = meta.data.length - 1; i >= 0; i--) {
        if (dataset.data[i] != null) {
          lastPoint = meta.data[i]
          break
        }
      }
      if (!lastPoint) return

      const color = dataset.segment?.borderColor
        ? dataset.borderColor
        : (dataset.borderColor || '#3b82f6')
      const resolvedColor = typeof color === 'function' ? '#3b82f6' : color

      ctx.save()
      ctx.globalAlpha = alpha
      ctx.beginPath()
      ctx.arc(lastPoint.x, lastPoint.y, 2.5 * scale, 0, Math.PI * 2)
      ctx.fillStyle = resolvedColor
      ctx.fill()
      ctx.restore()
    })
  },
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
  wrap: {
    padding: '1rem 0',
    paddingBottom: '5rem',
    background: 'var(--pm-bg, #f7f8fa)',
    minHeight: '100vh',
  },
  title: { margin: 0, marginBottom: '0.5rem', color: 'var(--pm-text, #1a1a2e)' },
  status: { marginBottom: '1rem', fontSize: '0.9rem', color: 'var(--pm-text-muted)' },
  chartCard: {
    position: 'relative',
    background: 'transparent',
    border: 'none',
    borderRadius: '0',
    padding: '0.75rem 0',
    marginBottom: '0.5rem',
    marginLeft: 0,
    marginRight: 0,
  },
  chartViewport: {
    position: 'relative',
    height: '32vh',
    maxHeight: '280px',
    minHeight: '180px',
  },
  chartTitle: {
    margin: '0 0 0.5rem 0',
    fontSize: '0.75rem',
    textAlign: 'center',
    fontWeight: 500,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: 'var(--pm-text-muted, #94a3b8)',
    opacity: 0.7,
  },
  errorCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--pm-card-bg)',
    border: '1px solid var(--pm-border)',
    borderRadius: '8px',
    padding: '2.5rem 1.5rem',
    textAlign: 'center',
    marginTop: '1rem',
  },
  errorIcon: {
    fontSize: '2.5rem',
    color: 'var(--pm-danger)',
    marginBottom: '0.75rem',
  },
  errorTitle: {
    fontSize: '1.1rem',
    fontWeight: 600,
    color: 'var(--pm-text)',
    margin: '0 0 0.4rem 0',
  },
  errorSubtext: {
    fontSize: '0.85rem',
    color: 'var(--pm-text-secondary)',
    margin: 0,
  },
}

const baseChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  interaction: { mode: 'index', intersect: false },
  plugins: { legend: { display: false } },
  elements: { point: { radius: 0 }, line: { borderWidth: 1.5 } },
  scales: {
    x: {
      ticks: {
        autoSkip: false,
        callback: function (value, index) {
          const label = this.getLabelForValue(index)
          if (!label) return null
          const [h, m] = label.split(':').map(Number)
          const totalMin = h * 60 + m
          return totalMin % 30 === 0 ? label : null
        },
        maxRotation: 0,
        color: 'var(--pm-text-muted, #9ca3af)',
      },
      grid: { display: false },
      border: { display: false },
    },
    y: {
      display: false,
    },
  },
}

const quantityChartOptions = {
  ...baseChartOptions,
}

const zeroLinePlugin = {
  id: 'zeroLine',
  afterDatasetsDraw(chart) {
    const { ctx, chartArea: { left, right }, scales: { y } } = chart
    if (!y) return
    const yPos = y.getPixelForValue(0)
    ctx.save()
    ctx.beginPath()
    ctx.setLineDash([4, 4])
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(150, 150, 150, 0.6)'
    ctx.moveTo(left, yPos)
    ctx.lineTo(right, yPos)
    ctx.stroke()
    ctx.restore()
  },
}

const pressureChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx) => {
          const dataset = ctx.chart?.data?.datasets?.[ctx.datasetIndex]
          const raw = dataset?.rawDiffs?.[ctx.dataIndex]
          if (raw != null) return `Sell−Buy: ${raw}`
          return `${ctx.parsed.y?.toFixed(3)}`
        },
      },
    },
  },
  elements: { point: { radius: 0 }, line: { borderWidth: 1.5 } },
  scales: {
    x: {
      ticks: {
        autoSkip: false,
        callback: function (value, index) {
          const label = this.getLabelForValue(index)
          if (!label) return null
          const [h, m] = label.split(':').map(Number)
          const totalMin = h * 60 + m
          return totalMin % 30 === 0 ? label : null
        },
        maxRotation: 0,
        color: 'var(--pm-text-muted, #9ca3af)',
      },
      grid: { display: false },
      border: { display: false },
    },
    y: {
      display: false,
      min: -1,
      max: 1,
      beginAtZero: true,
    },
  },
}

function MinuteProgressBar() {
  const [seconds, setSeconds] = useState(new Date().getSeconds())

  useEffect(() => {
    const interval = setInterval(() => {
      setSeconds(new Date().getSeconds())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const progress = (seconds / 60) * 100

  return (
    <div style={{
      position: 'fixed',
      bottom: '64px',
      left: 0,
      right: 0,
      height: '3px',
      background: 'var(--pm-border, #e5e7eb)',
      zIndex: 1001,
      overflow: 'visible',
    }}>
      <div style={{
        position: 'relative',
        height: '100%',
        width: `${progress}%`,
        background: '#3b82f6',
        transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        borderRadius: '0 2px 2px 0',
        overflow: 'visible',
      }}>
        <span style={{
          position: 'absolute',
          right: '-4px',
          top: '50%',
          transform: 'translateY(-50%)',
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: '#3b82f6',
          animation: 'pulse-bar 1s ease-in-out infinite',
          boxShadow: '0 0 6px #3b82f6',
        }} />
      </div>
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
  const pressureChartRef = useRef(null)
  const qtyChartRef = useRef(null)

  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsElapsed(new Date().getSeconds())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    let retryTimer = null
    let intentionalClose = false

    function connect() {
      const ws = new WebSocket(WS_URL)
      wsRef.current = ws

      ws.onopen = () => setStatus('connected')

      ws.onclose = () => {
        if (intentionalClose) return
        setStatus('reconnecting')
        retryTimer = setTimeout(connect, 3000)
      }

      ws.onerror = () => {
        // onclose will fire after this, triggering reconnect
      }

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
    }

    connect()

    return () => {
      intentionalClose = true
      if (retryTimer) clearTimeout(retryTimer)
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


  const PRE_PAD = 5
  const POST_PAD = 10

  const labels = useMemo(() => {
    const dataLabels = rows.map((r) => String(r.minute).split('T')[1]?.slice(0, 5) || String(r.minute))
    if (dataLabels.length === 0) return dataLabels

    // Always start from 08:55 (09:00 - 5 min pre-padding)
    const preLabels = []
    const startMin = 9 * 60 - PRE_PAD // 08:55
    for (let i = 0; i < PRE_PAD; i++) {
      const totalMin = startMin + i
      const h = String(Math.floor(totalMin / 60)).padStart(2, '0')
      const m = String(totalMin % 60).padStart(2, '0')
      preLabels.push(`${h}:${m}`)
    }

    // Append 10 minutes after last data point
    const lastLabel = dataLabels[dataLabels.length - 1]
    const [lh, lm] = lastLabel.split(':').map(Number)
    const postLabels = []
    for (let i = 1; i <= POST_PAD; i++) {
      const totalMin = lh * 60 + lm + i
      const h = String(Math.floor(totalMin / 60) % 24).padStart(2, '0')
      const m = String(totalMin % 60).padStart(2, '0')
      postLabels.push(`${h}:${m}`)
    }

    return [...preLabels, ...dataLabels, ...postLabels]
  }, [rows])

  const latestPrice = rows.length > 0 ? rows[rows.length - 1].close : null

  // Find opening price: first row at or after 09:00
  const openPrice = useMemo(() => {
    for (const r of rows) {
      const time = String(r.minute).split('T')[1]?.slice(0, 5) || ''
      if (time >= '09:00') return r.close
    }
    return rows.length > 0 ? rows[0].close : null
  }, [rows])

  const priceChartData = useMemo(() => {
    const isPositive = openPrice != null && latestPrice != null && latestPrice >= openPrice
    const lineColor = openPrice == null ? '#3b82f6' : (isPositive ? '#22c55e' : '#ef4444')
    const fillRgb = isPositive ? '34, 197, 94' : '239, 68, 68'
    const firstClose = rows.length > 0 ? rows[0].close : null
    const prePad = Array(PRE_PAD).fill(firstClose)

    return {
      labels,
      datasets: [
        {
          label: 'Close Price',
          data: [...prePad, ...rows.map((r) => r.close)],
          borderColor: lineColor,
          backgroundColor: (ctx) => {
            if (!ctx.chart) return 'transparent'
            const { top, bottom } = ctx.chart.chartArea || { top: 0, bottom: ctx.chart.height }
            const gradient = ctx.chart.ctx.createLinearGradient(0, top, 0, bottom)
            gradient.addColorStop(0, `rgba(${fillRgb}, 0.35)`)
            gradient.addColorStop(1, `rgba(${fillRgb}, 0)`)
            return gradient
          },
          fill: true,
        },
      ],
    }
  }, [labels, rows, openPrice, latestPrice])

  const qtyChartData = useMemo(() => {
    const clampedSeconds = Math.max(secondsElapsed, 10)
    const scaleFactor = 60 / clampedSeconds
    const lastIdx = rows.length - 1
    const paddedLastIdx = PRE_PAD + lastIdx

    const firstBuy = rows.length > 0 ? rows[0].buyQtySum : null
    const firstSell = rows.length > 0 ? rows[0].sellQtySum : null
    const buyPad = Array(PRE_PAD).fill(firstBuy)
    const sellPad = Array(PRE_PAD).fill(firstSell)

    // Completed minutes: all except the last (current) minute
    const buyCompleted = [...buyPad, ...rows.map((r, i) => i < lastIdx ? r.buyQtySum : null)]
    const sellCompleted = [...sellPad, ...rows.map((r, i) => i < lastIdx ? r.sellQtySum : null)]

    // Projected: bridge from last completed to projected current
    const prevBuy = lastIdx >= 1 ? rows[lastIdx - 1].buyQtySum : 0
    const prevSell = lastIdx >= 1 ? rows[lastIdx - 1].sellQtySum : 0

    const buyProjected = [...Array(PRE_PAD).fill(null), ...rows.map((r, i) => {
      if (i === lastIdx) {
        if (secondsElapsed < 3) return prevBuy
        return Math.round(r.buyQtySum * scaleFactor)
      }
      if (i === lastIdx - 1) return r.buyQtySum
      return null
    })]
    const sellProjected = [...Array(PRE_PAD).fill(null), ...rows.map((r, i) => {
      if (i === lastIdx) {
        if (secondsElapsed < 3) return prevSell
        return Math.round(r.sellQtySum * scaleFactor)
      }
      if (i === lastIdx - 1) return r.sellQtySum
      return null
    })]

    return {
      labels,
      datasets: [
        {
          label: 'Buy Qty',
          data: buyCompleted,
          borderColor: '#22c55e',
          backgroundColor: (ctx) => {
            if (!ctx.chart?.chartArea) return 'rgba(34, 197, 94, 0.1)'
            const { top, bottom } = ctx.chart.chartArea
            const gradient = ctx.chart.ctx.createLinearGradient(0, top, 0, bottom)
            gradient.addColorStop(0, 'rgba(34, 197, 94, 0.3)')
            gradient.addColorStop(1, 'rgba(34, 197, 94, 0)')
            return gradient
          },
          fill: true,
          spanGaps: false,
          skipPulsingDot: true,
        },
        {
          label: 'Sell Qty',
          data: sellCompleted,
          borderColor: '#ef4444',
          backgroundColor: (ctx) => {
            if (!ctx.chart?.chartArea) return 'rgba(239, 68, 68, 0.1)'
            const { top, bottom } = ctx.chart.chartArea
            const gradient = ctx.chart.ctx.createLinearGradient(0, top, 0, bottom)
            gradient.addColorStop(0, 'rgba(239, 68, 68, 0.3)')
            gradient.addColorStop(1, 'rgba(239, 68, 68, 0)')
            return gradient
          },
          fill: true,
          spanGaps: false,
          skipPulsingDot: true,
        },
        {
          label: 'Buy (Projected)',
          data: buyProjected,
          borderColor: '#22c55e',
          borderWidth: 1.5,
          pointRadius: (ctx) => ctx.dataIndex === paddedLastIdx ? 3 : 0,
          spanGaps: false,
        },
        {
          label: 'Sell (Projected)',
          data: sellProjected,
          borderColor: '#ef4444',
          borderWidth: 1.5,
          pointRadius: (ctx) => ctx.dataIndex === paddedLastIdx ? 3 : 0,
          spanGaps: false,
        },
      ],
    }
  }, [labels, rows, secondsElapsed])

  const pressureChartData = useMemo(() => {
    const diffs = rows.map((r) => (r.sellQtySum || 0) - (r.buyQtySum || 0))
    const maxAbs = Math.max(1, ...diffs.map(Math.abs))
    const tanhValues = diffs.map((d) => Math.tanh(d / (maxAbs * 0.05)))
    const firstTanh = tanhValues.length > 0 ? tanhValues[0] : 0
    const firstDiff = diffs.length > 0 ? diffs[0] : 0
    const data = [...Array(PRE_PAD).fill(firstTanh), ...tanhValues]
    const rawDiffs = [...Array(PRE_PAD).fill(firstDiff), ...diffs]

    return {
      labels,
      datasets: [
        {
          label: 'tanh(S−B)',
          data,
          rawDiffs,
          segment: {
            borderColor: (ctx) => ctx.p0.parsed.y >= 0 ? '#ef4444' : '#22c55e',
          },
          borderColor: '#ef4444',
          backgroundColor: (context) => {
            const chart = context.chart
            if (!chart.chartArea || !chart.scales?.y) return 'rgba(239, 68, 68, 0.15)'
            const { top, bottom } = chart.chartArea
            const zeroY = chart.scales.y.getPixelForValue(0)
            const ratio = Math.max(0, Math.min(1, (zeroY - top) / (bottom - top)))
            const gradient = chart.ctx.createLinearGradient(0, top, 0, bottom)
            gradient.addColorStop(0, 'rgba(239, 68, 68, 0.35)')
            gradient.addColorStop(ratio, 'rgba(239, 68, 68, 0)')
            gradient.addColorStop(ratio, 'rgba(34, 197, 94, 0)')
            gradient.addColorStop(1, 'rgba(34, 197, 94, 0.35)')
            return gradient
          },
          fill: true,
          borderWidth: 1.5,
          pointRadius: 0,
        },
      ],
    }
  }, [labels, rows])

  const syncChartsAtIndex = (sourceChart, index) => {
    const charts = [priceChartRef.current, pressureChartRef.current, qtyChartRef.current].filter(Boolean)
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
    ;[priceChartRef.current, pressureChartRef.current, qtyChartRef.current].filter(Boolean).forEach((chart) => {
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

  const isDisconnected = status === 'disconnected'

  return (
    <div style={styles.wrap}>
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }
        @keyframes pulse-bar {
          0%, 100% { opacity: 1; transform: translateY(-50%) scale(1); }
          50% { opacity: 0.4; transform: translateY(-50%) scale(0.6); }
        }
      `}</style>
      <h2 style={{ ...styles.title, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
        {status === 'connected' && (
          <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#22c55e', display: 'inline-block', flexShrink: 0, animation: 'pulse-dot 2s ease-in-out infinite' }} />
        )}
        {status === 'reconnecting' && (
          <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#f59e0b', display: 'inline-block', flexShrink: 0, animation: 'pulse-dot 1s ease-in-out infinite' }} />
        )}
        {status === 'connecting' && (
          <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#94a3b8', display: 'inline-block', flexShrink: 0, animation: 'pulse-dot 1.5s ease-in-out infinite' }} />
        )}
        {stocks.find((s) => s.instrumentKey === selectedInstrumentKey)?.displayName || 'Live Ticks'}
      </h2>

      {isDisconnected && (
        <div style={styles.errorCard}>
          <FontAwesomeIcon icon={faPlugCircleXmark} style={styles.errorIcon} />
          <p style={styles.errorTitle}>Unable to connect to WebSocket</p>
          <p style={styles.errorSubtext}>
            The live data server is not reachable. Please ensure the service is running and try again later.
          </p>
        </div>
      )}

      <MinuteProgressBar />
      {!isDisconnected && (
        <>
          <div style={{ marginBottom: '0.75rem', textAlign: 'center' }}>
            <select value={selectedInstrumentKey} onChange={handleStockChange} style={{ padding: '0.45rem', minWidth: '260px' }}>
              {stocks.map((stock) => (
                <option key={stock.instrumentKey} value={stock.instrumentKey}>
                  {stock.symbol} — {stock.displayName}
                </option>
              ))}
            </select>
          </div>

          <div style={styles.chartCard}>
            <h3 style={styles.chartTitle}>Live Price</h3>
            {latestPrice != null && (
              <div style={{ textAlign: 'center', marginBottom: '0.4rem' }}>
                <span style={{ color: openPrice != null && latestPrice >= openPrice ? '#22c55e' : '#ef4444', fontWeight: 700, fontSize: '1.1rem' }}>
                  {latestPrice.toFixed(2)}
                  {openPrice != null && (
                    <span style={{ fontSize: '0.8rem', marginLeft: '0.3rem', fontWeight: 600 }}>
                      ({latestPrice >= openPrice ? '+' : ''}{(latestPrice - openPrice).toFixed(2)})
                    </span>
                  )}
                </span>
              </div>
            )}
            <div style={styles.chartViewport}>
              <Line ref={priceChartRef} data={priceChartData} options={buildOptions(baseChartOptions)} plugins={[syncCrosshairPlugin, pulsingDotPlugin]} />
            </div>
          </div>

          <div style={styles.chartCard}>
            <h3 style={styles.chartTitle}>Sell Pressure</h3>
            <div style={{ ...styles.chartViewport, height: '20vh', maxHeight: '180px', minHeight: '120px' }}>
              <Line ref={pressureChartRef} data={pressureChartData} options={buildOptions(pressureChartOptions)} plugins={[syncCrosshairPlugin, zeroLinePlugin, pulsingDotPlugin]} />
            </div>
          </div>

          <div style={styles.chartCard}>
            <h3 style={styles.chartTitle}>Buy vs Sell</h3>
            <div style={styles.chartViewport}>
              <Line ref={qtyChartRef} data={qtyChartData} options={buildOptions(quantityChartOptions)} plugins={[syncCrosshairPlugin, pulsingDotPlugin]} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

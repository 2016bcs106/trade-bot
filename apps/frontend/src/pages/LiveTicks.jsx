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
import { faPlugCircleXmark, faRepeat } from '@fortawesome/free-solid-svg-icons'
import moment from 'moment'
import BottomSheet from '../components/BottomSheet'
import Loader from '../components/Loader'

const WS_URL = import.meta.env.VITE_LIVE_TICKS_WS_URL || 'wss://trade-bot-ws.duckdns.org:8081/live-ticks'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Title, Tooltip, Legend)

function getTodayIstDate() {
  return moment().utcOffset('+05:30').format('YYYY-MM-DD')
}

function isCurrentIstDayMinute(minute) {
  if (!minute) return false
  return String(minute).slice(0, 10) === getTodayIstDate()
}

// ─── Chart Plugins ──────────────────────────────────────────────

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
      let lastPoint = null
      for (let i = meta.data.length - 1; i >= 0; i--) {
        if (dataset.data[i] != null) { lastPoint = meta.data[i]; break }
      }
      if (!lastPoint) return

      const color = typeof dataset.borderColor === 'function' ? '#3b82f6' : (dataset.borderColor || '#3b82f6')
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.beginPath()
      ctx.arc(lastPoint.x, lastPoint.y, 2.5 * scale, 0, Math.PI * 2)
      ctx.fillStyle = color
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
    const { ctx, chartArea: { top, bottom, left, right } } = chart
    const { x, y } = active[0].element
    ctx.save()
    ctx.beginPath()
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)'
    ctx.setLineDash([4, 4])
    ctx.moveTo(x, top); ctx.lineTo(x, bottom)
    ctx.moveTo(left, y); ctx.lineTo(right, y)
    ctx.stroke()
    ctx.restore()
  },
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
    ctx.moveTo(left, yPos); ctx.lineTo(right, yPos)
    ctx.stroke()
    ctx.restore()
  },
}

// ─── Chart Options ──────────────────────────────────────────────

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
          return (h * 60 + m) % 30 === 0 ? label : null
        },
        maxRotation: 0,
        color: 'var(--color-text-muted)',
      },
      grid: { display: false },
      border: { display: false },
    },
    y: { display: false },
  },
}

const pressureChartOptions = {
  ...baseChartOptions,
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx) => {
          const raw = ctx.chart?.data?.datasets?.[ctx.datasetIndex]?.rawDiffs?.[ctx.dataIndex]
          return raw != null ? `Sell−Buy: ${raw}` : `${ctx.parsed.y?.toFixed(3)}`
        },
      },
    },
  },
  scales: {
    ...baseChartOptions.scales,
    y: { display: false, min: -1, max: 1, beginAtZero: true },
  },
}

// ─── Sub-components ──────────────────────────────────────────────

function MinuteProgressBar() {
  const [seconds, setSeconds] = useState(moment().seconds())

  useEffect(() => {
    const interval = setInterval(() => setSeconds(moment().seconds()), 1000)
    return () => clearInterval(interval)
  }, [])

  const progress = (seconds / 60) * 100

  return (
    <div style={styles.progressTrack}>
      <div style={{ ...styles.progressFill, width: `${progress}%` }}>
        <span style={styles.progressDot} />
      </div>
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────

const PRE_PAD = 5
const POST_PAD = 10

export default function LiveTicks() {
  const [status, setStatus] = useState('connecting')
  const [stocks, setStocks] = useState([])
  const [selectedInstrumentKey, setSelectedInstrumentKey] = useState('')
  const [rowsByMinute, setRowsByMinute] = useState({})
  const [secondsElapsed, setSecondsElapsed] = useState(moment().seconds())
  const [sheetOpen, setSheetOpen] = useState(false)
  const wsRef = useRef(null)
  const priceChartRef = useRef(null)
  const pressureChartRef = useRef(null)
  const qtyChartRef = useRef(null)

  useEffect(() => {
    const interval = setInterval(() => setSecondsElapsed(moment().seconds()), 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    let retryTimer = null
    let intentionalClose = false

    function connect() {
      const ws = new WebSocket(WS_URL)
      wsRef.current = ws
      ws.onopen = () => setStatus('connected')
      ws.onclose = () => { if (!intentionalClose) { setStatus('reconnecting'); retryTimer = setTimeout(connect, 3000) } }
      ws.onerror = () => {}
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'stock_list' && Array.isArray(msg.data)) {
            setStocks(msg.data)
            if (msg.data.length > 0) {
              const firstKey = msg.data[0].instrumentKey
              setSelectedInstrumentKey(firstKey)
              ws.send(JSON.stringify({ type: 'subscribe', data: { instrumentKey: firstKey } }))
            }
            return
          }
          if (msg.type === 'snapshot' && Array.isArray(msg.data)) {
            const next = {}
            for (const item of msg.data) { if (item?.minute && isCurrentIstDayMinute(item.minute)) next[item.minute] = item }
            setRowsByMinute(next)
            return
          }
          if (msg.type === 'minute_update' && msg.data?.minute) {
            if (!isCurrentIstDayMinute(msg.data.minute)) return
            setRowsByMinute((prev) => ({ ...prev, [msg.data.minute]: msg.data }))
            return
          }
          if (msg.type === 'day_reset') setRowsByMinute({})
        } catch {}
      }
    }

    connect()
    return () => { intentionalClose = true; if (retryTimer) clearTimeout(retryTimer); wsRef.current?.close() }
  }, [])

  const handleStockSelect = (instrumentKey) => {
    setSelectedInstrumentKey(instrumentKey)
    setRowsByMinute({})
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', data: { instrumentKey } }))
    }
  }

  const rows = useMemo(
    () => Object.values(rowsByMinute).sort((a, b) => String(a.minute).localeCompare(String(b.minute))),
    [rowsByMinute],
  )

  const labels = useMemo(() => {
    const dataLabels = rows.map((r) => String(r.minute).split('T')[1]?.slice(0, 5) || String(r.minute))
    if (dataLabels.length === 0) return dataLabels

    const preLabels = []
    const startMin = 9 * 60 - PRE_PAD
    for (let i = 0; i < PRE_PAD; i++) {
      const t = startMin + i
      preLabels.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`)
    }

    const lastLabel = dataLabels[dataLabels.length - 1]
    const [lh, lm] = lastLabel.split(':').map(Number)
    const postLabels = []
    for (let i = 1; i <= POST_PAD; i++) {
      const t = lh * 60 + lm + i
      postLabels.push(`${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`)
    }

    return [...preLabels, ...dataLabels, ...postLabels]
  }, [rows])

  const latestPrice = rows.length > 0 ? rows[rows.length - 1].close : null
  const openPrice = useMemo(() => {
    for (const r of rows) {
      const time = String(r.minute).split('T')[1]?.slice(0, 5) || ''
      if (time >= '09:00') return r.close
    }
    return rows.length > 0 ? rows[0].close : null
  }, [rows])

  const priceChartData = useMemo(() => {
    const isPositive = openPrice != null && latestPrice != null && latestPrice >= openPrice
    const lineColor = openPrice == null ? 'var(--color-info)' : (isPositive ? 'var(--color-success)' : 'var(--color-danger)')
    const fillRgb = isPositive ? '34, 197, 94' : '239, 68, 68'
    const firstClose = rows.length > 0 ? rows[0].close : null

    return {
      labels,
      datasets: [{
        label: 'Close Price',
        data: [...Array(PRE_PAD).fill(firstClose), ...rows.map((r) => r.close)],
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
      }],
    }
  }, [labels, rows, openPrice, latestPrice])

  const qtyChartData = useMemo(() => {
    const clampedSeconds = Math.max(secondsElapsed, 10)
    const scaleFactor = 60 / clampedSeconds
    const lastIdx = rows.length - 1
    const paddedLastIdx = PRE_PAD + lastIdx
    const firstBuy = rows.length > 0 ? rows[0].buyQtySum : null
    const firstSell = rows.length > 0 ? rows[0].sellQtySum : null

    const buyCompleted = [...Array(PRE_PAD).fill(firstBuy), ...rows.map((r, i) => i < lastIdx ? r.buyQtySum : null)]
    const sellCompleted = [...Array(PRE_PAD).fill(firstSell), ...rows.map((r, i) => i < lastIdx ? r.sellQtySum : null)]
    const prevBuy = lastIdx >= 1 ? rows[lastIdx - 1].buyQtySum : 0
    const prevSell = lastIdx >= 1 ? rows[lastIdx - 1].sellQtySum : 0

    const buyProjected = [...Array(PRE_PAD).fill(null), ...rows.map((r, i) => {
      if (i === lastIdx) return secondsElapsed < 3 ? prevBuy : Math.round(r.buyQtySum * scaleFactor)
      return i === lastIdx - 1 ? r.buyQtySum : null
    })]
    const sellProjected = [...Array(PRE_PAD).fill(null), ...rows.map((r, i) => {
      if (i === lastIdx) return secondsElapsed < 3 ? prevSell : Math.round(r.sellQtySum * scaleFactor)
      return i === lastIdx - 1 ? r.sellQtySum : null
    })]

    const mkGradient = (rgb) => (ctx) => {
      if (!ctx.chart?.chartArea) return `rgba(${rgb}, 0.1)`
      const { top, bottom } = ctx.chart.chartArea
      const g = ctx.chart.ctx.createLinearGradient(0, top, 0, bottom)
      g.addColorStop(0, `rgba(${rgb}, 0.3)`); g.addColorStop(1, `rgba(${rgb}, 0)`)
      return g
    }

    return {
      labels,
      datasets: [
        { label: 'Buy Qty', data: buyCompleted, borderColor: 'var(--color-success)', backgroundColor: mkGradient('34, 197, 94'), fill: true, spanGaps: false, skipPulsingDot: true },
        { label: 'Sell Qty', data: sellCompleted, borderColor: 'var(--color-danger)', backgroundColor: mkGradient('239, 68, 68'), fill: true, spanGaps: false, skipPulsingDot: true },
        { label: 'Buy (Projected)', data: buyProjected, borderColor: 'var(--color-success)', borderWidth: 1.5, pointRadius: (ctx) => ctx.dataIndex === paddedLastIdx ? 3 : 0, spanGaps: false },
        { label: 'Sell (Projected)', data: sellProjected, borderColor: 'var(--color-danger)', borderWidth: 1.5, pointRadius: (ctx) => ctx.dataIndex === paddedLastIdx ? 3 : 0, spanGaps: false },
      ],
    }
  }, [labels, rows, secondsElapsed])

  const pressureChartData = useMemo(() => {
    const diffs = rows.map((r) => (r.sellQtySum || 0) - (r.buyQtySum || 0))
    const maxAbs = Math.max(1, ...diffs.map(Math.abs))
    const tanhValues = diffs.map((d) => Math.tanh(d / (maxAbs * 0.05)))
    const firstTanh = tanhValues.length > 0 ? tanhValues[0] : 0
    const firstDiff = diffs.length > 0 ? diffs[0] : 0

    return {
      labels,
      datasets: [{
        label: 'tanh(S−B)',
        data: [...Array(PRE_PAD).fill(firstTanh), ...tanhValues],
        rawDiffs: [...Array(PRE_PAD).fill(firstDiff), ...diffs],
        segment: { borderColor: (ctx) => ctx.p0.parsed.y >= 0 ? 'var(--color-danger)' : 'var(--color-success)' },
        borderColor: 'var(--color-danger)',
        backgroundColor: (context) => {
          const chart = context.chart
          if (!chart.chartArea || !chart.scales?.y) return 'rgba(239, 68, 68, 0.15)'
          const { top, bottom } = chart.chartArea
          const zeroY = chart.scales.y.getPixelForValue(0)
          const ratio = Math.max(0, Math.min(1, (zeroY - top) / (bottom - top)))
          const g = chart.ctx.createLinearGradient(0, top, 0, bottom)
          g.addColorStop(0, 'rgba(239, 68, 68, 0.35)'); g.addColorStop(ratio, 'rgba(239, 68, 68, 0)')
          g.addColorStop(ratio, 'rgba(34, 197, 94, 0)'); g.addColorStop(1, 'rgba(34, 197, 94, 0.35)')
          return g
        },
        fill: true,
        borderWidth: 1.5,
        pointRadius: 0,
      }],
    }
  }, [labels, rows])

  const syncChartsAtIndex = (sourceChart, index) => {
    const charts = [priceChartRef.current, pressureChartRef.current, qtyChartRef.current].filter(Boolean)
    const sourceLabel = sourceChart?.data?.labels?.[index]
    charts.forEach((target) => {
      if (sourceLabel == null) { target.setActiveElements([]); target.tooltip?.setActiveElements([], { x: 0, y: 0 }); target.update('none'); return }
      const mappedIndex = target.data.labels.indexOf(sourceLabel)
      if (mappedIndex >= 0) { target.setActiveElements([{ datasetIndex: 0, index: mappedIndex }]); target.tooltip?.setActiveElements([{ datasetIndex: 0, index: mappedIndex }], { x: 0, y: 0 }) }
      else { target.setActiveElements([]); target.tooltip?.setActiveElements([], { x: 0, y: 0 }) }
      target.update('none')
    })
  }

  const clearSyncedHover = () => {
    [priceChartRef.current, pressureChartRef.current, qtyChartRef.current].filter(Boolean).forEach((chart) => {
      chart.setActiveElements([]); chart.tooltip?.setActiveElements([], { x: 0, y: 0 }); chart.update('none')
    })
  }

  const buildOptions = (base) => ({
    ...base,
    plugins: { ...base.plugins, syncCrosshair: true },
    onHover: (event, elements, chart) => {
      if (!elements.length) { clearSyncedHover(); return }
      syncChartsAtIndex(chart, elements[0].index)
    },
  })

  const isDisconnected = status === 'disconnected'
  const selectedStock = stocks.find((s) => s.instrumentKey === selectedInstrumentKey)

  if (!selectedStock) {
    return <div style={styles.wrap}><Loader /></div>
  }

  return (
    <div style={styles.wrap}>
      {/* Header */}
      <h2 style={styles.header}>
        {status === 'connected' && <span style={{ ...styles.dot, background: 'var(--color-success)' }} />}
        {status === 'reconnecting' && <span style={{ ...styles.dot, background: 'var(--color-warning)', animationDuration: '1s' }} />}
        {selectedStock.displayName}
        <span style={styles.symbolTag}>{selectedStock.symbol}</span>
        <FontAwesomeIcon icon={faRepeat} onClick={() => setSheetOpen(true)} style={styles.switchBtn} />
      </h2>

      {isDisconnected && (
        <div style={styles.errorCard}>
          <FontAwesomeIcon icon={faPlugCircleXmark} style={styles.errorIcon} />
          <p style={styles.errorTitle}>Unable to connect</p>
          <p style={styles.errorSubtext}>The live data server is not reachable.</p>
        </div>
      )}

      <MinuteProgressBar />

      {!isDisconnected && (
        <>
          {/* Stock selector */}
          <BottomSheet title="Select Stock" isOpen={sheetOpen} onClose={() => setSheetOpen(false)}>
            {stocks.map((stock) => (
              <button
                key={stock.instrumentKey}
                onClick={() => { handleStockSelect(stock.instrumentKey); setSheetOpen(false) }}
                style={{
                  ...styles.sheetItem,
                  background: stock.instrumentKey === selectedInstrumentKey ? 'var(--color-primary-light)' : 'transparent',
                }}
              >
                <span style={{ fontSize: 'var(--font-md)', color: 'var(--color-text)' }}>{stock.displayName}</span>
                <span style={{ fontWeight: 600, fontSize: 'var(--font-sm)', color: 'var(--color-text-muted)' }}>{stock.symbol}</span>
              </button>
            ))}
          </BottomSheet>

          {/* Price chart */}
          <div style={styles.chartCard}>
            <h3 style={styles.chartTitle}>Live Price</h3>
            {latestPrice != null && (
              <div style={styles.priceRow}>
                <span style={{ color: openPrice != null && latestPrice >= openPrice ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 700, fontSize: 'var(--font-xl)' }}>
                  {latestPrice.toFixed(2)}
                  {openPrice != null && (
                    <span style={{ fontSize: 'var(--font-base)', marginLeft: '0.3rem', fontWeight: 600 }}>
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

          {/* Pressure chart */}
          <div style={styles.chartCard}>
            <h3 style={styles.chartTitle}>Sell Pressure</h3>
            <div style={{ ...styles.chartViewport, height: '20vh', maxHeight: '180px', minHeight: '120px' }}>
              <Line ref={pressureChartRef} data={pressureChartData} options={buildOptions(pressureChartOptions)} plugins={[syncCrosshairPlugin, zeroLinePlugin, pulsingDotPlugin]} />
            </div>
          </div>

          {/* Qty chart */}
          <div style={styles.chartCard}>
            <h3 style={styles.chartTitle}>Buy vs Sell</h3>
            <div style={styles.chartViewport}>
              <Line ref={qtyChartRef} data={qtyChartData} options={buildOptions(baseChartOptions)} plugins={[syncCrosshairPlugin, pulsingDotPlugin]} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const styles = {
  wrap: {
    padding: 'var(--space-lg) 0',
    paddingBottom: '5rem',
    background: 'var(--color-bg)',
    minHeight: '100vh',
  },
  header: {
    margin: 0,
    marginBottom: 'var(--space-sm)',
    color: 'var(--color-text)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-sm)',
    fontSize: 'var(--font-lg)',
    fontWeight: 600,
  },
  dot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    display: 'inline-block',
    flexShrink: 0,
    animation: 'pulse-dot 2s ease-in-out infinite',
  },
  symbolTag: {
    fontSize: 'var(--font-sm)',
    color: 'var(--color-text-muted)',
    fontWeight: 400,
  },
  switchBtn: {
    fontSize: 'var(--font-sm)',
    color: 'var(--color-primary)',
    cursor: 'pointer',
    marginLeft: 'var(--space-xs)',
  },
  errorCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--color-card)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    padding: '2.5rem var(--space-xl)',
    textAlign: 'center',
    marginTop: 'var(--space-lg)',
  },
  errorIcon: { fontSize: '2.5rem', color: 'var(--color-danger)', marginBottom: 'var(--space-md)' },
  errorTitle: { fontSize: 'var(--font-xl)', fontWeight: 600, color: 'var(--color-text)', margin: '0 0 0.4rem 0' },
  errorSubtext: { fontSize: 'var(--font-md)', color: 'var(--color-text-secondary)', margin: 0 },
  chartCard: {
    position: 'relative',
    background: 'transparent',
    border: 'none',
    padding: 'var(--space-md) 0',
    marginBottom: 'var(--space-sm)',
  },
  chartTitle: {
    margin: '0 0 var(--space-sm) 0',
    fontSize: 'var(--font-sm)',
    textAlign: 'center',
    fontWeight: 500,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: 'var(--color-text-muted)',
    opacity: 0.7,
  },
  chartViewport: {
    position: 'relative',
    height: '32vh',
    maxHeight: '280px',
    minHeight: '180px',
  },
  priceRow: { textAlign: 'center', marginBottom: 'var(--space-sm)' },
  progressTrack: {
    position: 'fixed',
    bottom: '64px',
    left: 0,
    right: 0,
    height: '3px',
    background: 'var(--color-border)',
    zIndex: 1001,
    overflow: 'visible',
  },
  progressFill: {
    position: 'relative',
    height: '100%',
    background: 'var(--color-info)',
    transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    borderRadius: '0 2px 2px 0',
    overflow: 'visible',
  },
  progressDot: {
    position: 'absolute',
    right: '-4px',
    top: '50%',
    transform: 'translateY(-50%)',
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: 'var(--color-info)',
    animation: 'pulse-dot 1s ease-in-out infinite',
    boxShadow: '0 0 6px var(--color-info)',
  },
  sheetItem: {
    width: '100%',
    padding: 'var(--space-md) var(--space-lg)',
    border: 'none',
    borderBottom: '1px solid var(--color-border)',
    textAlign: 'left',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
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
import { faPlugCircleXmark, faChevronLeft, faChevronDown, faStar as faStarSolid, faSliders, faCircleQuestion } from '@fortawesome/free-solid-svg-icons'
import { faStar as faStarOutline } from '@fortawesome/free-regular-svg-icons'
import moment from 'moment'
import BottomSheet from '../components/BottomSheet'
import Loader from '../components/Loader'
import StatusBadges from '../components/StatusBadges'
import { useApp } from '../context/AppContext'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Title, Tooltip, Legend)


let _marketOpen = false

// ─── Chart Plugins ──────────────────────────────────────────────

const pulsingDotPlugin = {
  id: 'pulsingDot',
  afterDatasetsDraw(chart) {
    const { ctx, chartArea } = chart
    if (!chartArea) return
    const time = Date.now() / 1000
    const alpha = _marketOpen ? (0.6 + 0.4 * Math.sin(time * 6)) : 0.5
    const radius = 3

    chart.data.datasets.forEach((dataset, datasetIndex) => {
      if (dataset.skipPulsingDot) return
      const meta = chart.getDatasetMeta(datasetIndex)
      if (!meta.visible) return
      let lastPoint = null
      for (let i = meta.data.length - 1; i >= 0; i--) {
        if (dataset.data[i] != null) { lastPoint = meta.data[i]; break }
      }
      if (!lastPoint) return

      const color = _marketOpen
        ? (typeof dataset.borderColor === 'function' ? '#007aff' : (dataset.borderColor || '#007aff'))
        : '#8e8e93'
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(lastPoint.x, lastPoint.y, radius, 0, Math.PI * 2)
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
    ctx.lineWidth = 0.5
    ctx.strokeStyle = 'rgba(60, 60, 67, 0.3)'
    ctx.setLineDash([4, 3])
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
    ctx.setLineDash([4, 3])
    ctx.lineWidth = 0.5
    ctx.strokeStyle = 'rgba(60, 60, 67, 0.2)'
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
  plugins: { legend: { display: false }, tooltip: { enabled: true, backgroundColor: 'rgba(0,0,0,0.72)', titleFont: { size: 11 }, bodyFont: { size: 11 }, padding: 8, cornerRadius: 8 } },
  elements: { point: { radius: 0 }, line: { borderWidth: 1.5, tension: 0.15 } },
  scales: {
    x: {
      ticks: {
        autoSkip: false,
        callback: function (value, index) {
          const label = this.getLabelForValue(index)
          if (!label) return null
          const [h, m] = label.split(':').map(Number)
          return (h * 60 + m) % 60 === 0 ? label : null
        },
        maxRotation: 0,
        font: { size: 10 },
        color: 'rgba(60, 60, 67, 0.4)',
      },
      grid: { display: false },
      border: { display: false },
    },
    y: { display: false },
  },
}

const priceChartOptions = {
  ...baseChartOptions,
  plugins: {
    ...baseChartOptions.plugins,
    tooltip: {
      ...baseChartOptions.plugins.tooltip,
      filter: (item) => item.dataset.label === 'Close Price',
    },
  },
}

const pressureChartOptions = {
  ...baseChartOptions,
  plugins: {
    ...baseChartOptions.plugins,
    tooltip: {
      ...baseChartOptions.plugins.tooltip,
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
    y: { display: false, beginAtZero: true },
  },
}

const rsiChartOptions = {
  ...baseChartOptions,
  scales: {
    ...baseChartOptions.scales,
    y: { display: false, min: 0, max: 100 },
  },
}

const rsiZonePlugin = {
  id: 'rsiZones',
  beforeDatasetsDraw(chart) {
    const { ctx, chartArea: { left, right, top, bottom }, scales: { y } } = chart
    if (!y) return
    const y70 = y.getPixelForValue(70)
    const y30 = y.getPixelForValue(30)
    ctx.save()
    ctx.fillStyle = 'rgba(255, 59, 48, 0.04)'
    ctx.fillRect(left, top, right - left, y70 - top)
    ctx.fillStyle = 'rgba(52, 199, 89, 0.04)'
    ctx.fillRect(left, y30, right - left, bottom - y30)
    ctx.setLineDash([4, 3])
    ctx.lineWidth = 0.5
    ctx.strokeStyle = 'rgba(60, 60, 67, 0.2)'
    ctx.beginPath()
    ctx.moveTo(left, y70); ctx.lineTo(right, y70)
    ctx.moveTo(left, y30); ctx.lineTo(right, y30)
    ctx.stroke()
    ctx.restore()
  },
}

const ratioChartOptions = {
  ...baseChartOptions,
  scales: {
    ...baseChartOptions.scales,
    y: { display: false },
  },
}

const ratioOneLinePlugin = {
  id: 'ratioOneLine',
  beforeDatasetsDraw(chart) {
    const { ctx, chartArea: { left, right }, scales: { y } } = chart
    if (!y) return
    const yPos = y.getPixelForValue(1)
    ctx.save()
    ctx.setLineDash([4, 3])
    ctx.lineWidth = 0.5
    ctx.strokeStyle = 'rgba(60, 60, 67, 0.2)'
    ctx.beginPath()
    ctx.moveTo(left, yPos); ctx.lineTo(right, yPos)
    ctx.stroke()
    ctx.restore()
  },
}

// ─── Main Component ──────────────────────────────────────────────

// Fixed time window: 09:00 to 15:30 (391 labels inclusive)
const MARKET_START = 9 * 60
const MARKET_END = 15 * 60 + 30
const FIXED_LABELS = []
for (let t = MARKET_START; t <= MARKET_END; t++) {
  FIXED_LABELS.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`)
}

export default function LiveTicks() {
  const { symbol } = useParams()
  const navigate = useNavigate()
  const { status, stocks, selectedInstrumentKey, rowsByMinute, selectStock, subscribeStock, unsubscribeStock, toggleFavorite, getPriceInfo, marketStatus } = useApp()
  const isMarketOpen = () => marketStatus !== 'Closed'
  _marketOpen = marketStatus !== 'Closed'
  const [secondsElapsed, setSecondsElapsed] = useState(moment().seconds())
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetSearch, setSheetSearch] = useState('')
  const [chartSettingsOpen, setChartSettingsOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const rsiChartRef = useRef(null)
  const ratioChartRef = useRef(null)
  const [visibleCharts, setVisibleCharts] = useState(() => {
    try {
      const saved = localStorage.getItem('liveTicksVisibleCharts')
      if (saved) return JSON.parse(saved)
    } catch {}
    return { price: true, rsi: true, ratio: true, pressure: true, volume: true }
  })
  const priceChartRef = useRef(null)
  const pressureChartRef = useRef(null)
  const qtyChartRef = useRef(null)

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
  const MAX_ZOOM_WINDOW = 180
  const [zoomRange, setZoomRange] = useState(null)
  const zoomInitialized = useRef(false)
  const pinchRef = useRef(null)

  const handlePinch = useCallback((e) => {
    if (!isMobile || !zoomRange) return
    const touches = e.touches
    if (touches.length !== 2) return
    const dist = Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)

    if (!pinchRef.current) {
      pinchRef.current = { startDist: dist, startRange: { ...zoomRange } }
      return
    }

    const scale = pinchRef.current.startDist / dist
    const { startRange } = pinchRef.current
    const startWidth = startRange.end - startRange.start
    const newWidth = Math.max(20, Math.min(MAX_ZOOM_WINDOW, Math.round(startWidth * scale)))
    const mid = Math.round((startRange.start + startRange.end) / 2)
    const halfNew = Math.round(newWidth / 2)
    let newStart = mid - halfNew
    let newEnd = mid + (newWidth - halfNew)
    if (newStart < 0) { newEnd -= newStart; newStart = 0 }
    if (newEnd > FIXED_LABELS.length - 1) { newStart -= (newEnd - FIXED_LABELS.length + 1); newEnd = FIXED_LABELS.length - 1 }
    newStart = Math.max(0, newStart)
    setZoomRange({ start: newStart, end: newEnd })
  }, [isMobile, zoomRange])

  const handlePinchEnd = useCallback(() => { pinchRef.current = null }, [])

  useEffect(() => {
    if (symbol && stocks.length > 0) {
      const match = stocks.find((s) => s.symbol === symbol)
      if (match) {
        selectStock(match.instrumentKey)
        subscribeStock(match.instrumentKey)
      }
    }
    return () => {
      if (symbol && stocks.length > 0) {
        const match = stocks.find((s) => s.symbol === symbol)
        if (match) unsubscribeStock(match.instrumentKey)
      }
    }
  }, [symbol, stocks])

  useEffect(() => {
    const interval = setInterval(() => setSecondsElapsed(moment().seconds()), 1000)
    return () => clearInterval(interval)
  }, [])

  const rowsByTime = useMemo(() => {
    const map = {}
    for (const r of Object.values(rowsByMinute)) {
      const time = String(r.minute).split('T')[1]?.slice(0, 5)
      if (time) map[time] = r
    }
    return map
  }, [rowsByMinute])

  const rows = useMemo(
    () => FIXED_LABELS.map((t) => rowsByTime[t] || null),
    [rowsByTime],
  )

  useEffect(() => {
    if (!isMobile || zoomInitialized.current) return
    let lastIdx = -1
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i]) { lastIdx = i; break }
    }
    if (lastIdx >= 0) {
      zoomInitialized.current = true
      const end = Math.min(lastIdx + 5, FIXED_LABELS.length - 1)
      setZoomRange({ start: Math.max(0, end - MAX_ZOOM_WINDOW), end })
    }
  }, [rows, isMobile])

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

  const priceChartData = useMemo(() => {
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
        {
          label: 'Upper Band',
          data: upper,
          borderColor: bandColor,
          borderWidth: 0.5,
          borderDash: [3, 3],
          pointRadius: 0,
          fill: false,
          spanGaps: true,
          skipPulsingDot: true,
        },
        {
          label: 'Lower Band',
          data: lower,
          borderColor: bandColor,
          borderWidth: 0.5,
          borderDash: [3, 3],
          pointRadius: 0,
          fill: '-1',
          backgroundColor: 'rgba(0, 122, 255, 0.04)',
          spanGaps: true,
          skipPulsingDot: true,
        },
        {
          label: 'SMA (20)',
          data: sma,
          borderColor: smaColor,
          borderWidth: 1,
          borderDash: [2, 2],
          pointRadius: 0,
          fill: false,
          spanGaps: true,
          skipPulsingDot: true,
        },
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

  const qtyChartData = useMemo(() => {
    const clampedSeconds = Math.max(secondsElapsed, 10)
    const scaleFactor = 60 / clampedSeconds
    const marketLive = isMarketOpen()

    // Find the last data index
    let lastDataIdx = -1
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i]) { lastDataIdx = i; break }
    }

    // Find previous data index (for projection bridge)
    let prevDataIdx = -1
    for (let i = lastDataIdx - 1; i >= 0; i--) {
      if (rows[i]) { prevDataIdx = i; break }
    }

    const prevBuy = prevDataIdx >= 0 ? rows[prevDataIdx].buyQtySum : 0
    const prevSell = prevDataIdx >= 0 ? rows[prevDataIdx].sellQtySum : 0

    const buyCompleted = rows.map((r, i) => {
      if (!r) return null
      if (i === lastDataIdx) return null
      return r.buyQtySum
    })
    const sellCompleted = rows.map((r, i) => {
      if (!r) return null
      if (i === lastDataIdx) return null
      return r.sellQtySum
    })

    const buyProjected = rows.map((r, i) => {
      if (i === lastDataIdx && r) return !marketLive || secondsElapsed < 3 ? prevBuy : Math.round(r.buyQtySum * scaleFactor)
      if (i === prevDataIdx && rows[prevDataIdx]) return rows[prevDataIdx].buyQtySum
      return null
    })
    const sellProjected = rows.map((r, i) => {
      if (i === lastDataIdx && r) return !marketLive || secondsElapsed < 3 ? prevSell : Math.round(r.sellQtySum * scaleFactor)
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

    const buyColor = '#34c759'
    const sellColor = '#ff3b30'
    const buyRgb = '52, 199, 89'
    const sellRgb = '255, 59, 48'

    return {
      labels: FIXED_LABELS,
      datasets: [
        { label: 'Buy Qty', data: buyCompleted, borderColor: buyColor, backgroundColor: mkGradient(buyRgb), fill: true, spanGaps: true, skipPulsingDot: true },
        { label: 'Sell Qty', data: sellCompleted, borderColor: sellColor, backgroundColor: mkGradient(sellRgb), fill: true, spanGaps: true, skipPulsingDot: true },
        { label: 'Buy (Projected)', data: buyProjected, borderColor: buyColor, borderWidth: 1.5, pointRadius: (ctx) => ctx.dataIndex === lastDataIdx ? 3 : 0, pointBackgroundColor: buyColor, pointBorderWidth: 0, spanGaps: true },
        { label: 'Sell (Projected)', data: sellProjected, borderColor: sellColor, borderWidth: 1.5, pointRadius: (ctx) => ctx.dataIndex === lastDataIdx ? 3 : 0, pointBackgroundColor: sellColor, pointBorderWidth: 0, spanGaps: true },
      ],
    }
  }, [rows, secondsElapsed])

  const pressureChartData = useMemo(() => {
    const diffs = rows.map((r) => r ? (r.sellQtySum || 0) - (r.buyQtySum || 0) : null)
    const validDiffs = diffs.filter((d) => d != null)
    const maxAbs = Math.max(1, ...validDiffs.map(Math.abs))
    const tanhValues = diffs.map((d) => d != null ? Math.tanh(d / (maxAbs * 0.05)) : null)

    const sellC = 'rgba(255, 59, 48'
    const buyC = 'rgba(52, 199, 89'

    return {
      labels: FIXED_LABELS,
      datasets: [{
        label: 'tanh(S−B)',
        data: tanhValues,
        rawDiffs: diffs,
        segment: { borderColor: (ctx) => ctx.p0.parsed.y >= 0 ? '#ff3b30' : '#34c759' },
        borderColor: '#ff3b30',
        backgroundColor: (context) => {
          const chart = context.chart
          if (!chart.chartArea || !chart.scales?.y) return `${sellC}, 0.08)`
          const { top, bottom } = chart.chartArea
          const zeroY = chart.scales.y.getPixelForValue(0)
          const ratio = Math.max(0, Math.min(1, (zeroY - top) / (bottom - top)))
          const g = chart.ctx.createLinearGradient(0, top, 0, bottom)
          g.addColorStop(0, `${sellC}, 0.15)`); g.addColorStop(ratio, `${sellC}, 0)`)
          g.addColorStop(ratio, `${buyC}, 0)`); g.addColorStop(1, `${buyC}, 0.15)`)
          return g
        },
        fill: true,
        borderWidth: 1.5,
        pointRadius: 0,
        spanGaps: true,
      }],
    }
  }, [rows])

  const rsiChartData = useMemo(() => {
    const period = 14

    const ratios = rows.map((r) => {
      if (!r) return null
      const sell = r.sellQtySum || 0
      return sell > 0 ? r.buyQtySum / sell : 1
    })

    const rsi = new Array(ratios.length).fill(null)
    let avgGain = 0, avgLoss = 0
    let count = 0, startIdx = -1
    for (let i = 0; i < ratios.length && count <= period; i++) {
      if (ratios[i] == null) continue
      if (startIdx === -1) { startIdx = i; count++; continue }
      const diff = ratios[i] - (ratios[i - 1] ?? ratios[i])
      let prevIdx = i - 1
      while (prevIdx >= 0 && ratios[prevIdx] == null) prevIdx--
      if (prevIdx < 0) { count++; continue }
      const change = ratios[i] - ratios[prevIdx]
      if (change > 0) avgGain += change; else avgLoss -= change
      count++
    }

    let seedEnd = -1
    count = 0
    for (let i = 0; i < ratios.length; i++) {
      if (ratios[i] != null) count++
      if (count === period + 1) { seedEnd = i; break }
    }

    if (seedEnd === -1) return { labels: FIXED_LABELS, datasets: [] }

    avgGain /= period
    avgLoss /= period
    rsi[seedEnd] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)

    let prevVal = ratios[seedEnd]
    for (let i = seedEnd + 1; i < ratios.length; i++) {
      if (ratios[i] == null) continue
      const change = ratios[i] - prevVal
      const gain = change > 0 ? change : 0
      const loss = change < 0 ? -change : 0
      avgGain = (avgGain * (period - 1) + gain) / period
      avgLoss = (avgLoss * (period - 1) + loss) / period
      rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
      prevVal = ratios[i]
    }

    const rsiMapped = rows.map((r, i) => r ? rsi[i] : null)

    return {
      labels: FIXED_LABELS,
      datasets: [
        { label: 'B/S Ratio RSI', data: rsiMapped, borderColor: '#007aff', borderWidth: 1.5, pointRadius: 0, spanGaps: true, fill: false },
      ],
    }
  }, [rows])

  const ratioChartData = useMemo(() => {
    const data = rows.map((r) => {
      if (!r) return null
      const sell = r.sellQtySum || 0
      return sell > 0 ? r.buyQtySum / sell : null
    })

    const lineColor = '#007aff'
    const fillRgb = '0, 122, 255'

    return {
      labels: FIXED_LABELS,
      datasets: [{
        label: 'Buy/Sell Ratio',
        data,
        borderColor: lineColor,
        backgroundColor: (ctx) => {
          if (!ctx.chart?.chartArea) return 'transparent'
          const { top, bottom } = ctx.chart.chartArea
          const g = ctx.chart.ctx.createLinearGradient(0, top, 0, bottom)
          g.addColorStop(0, `rgba(${fillRgb}, 0.12)`)
          g.addColorStop(1, `rgba(${fillRgb}, 0)`)
          return g
        },
        fill: true,
        borderWidth: 1.5,
        pointRadius: 0,
        spanGaps: true,
      }],
    }
  }, [rows])

  const syncChartsAtIndex = (sourceChart, index) => {
    const charts = [priceChartRef.current, pressureChartRef.current, qtyChartRef.current, rsiChartRef.current, ratioChartRef.current].filter(Boolean)
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
    [priceChartRef.current, pressureChartRef.current, qtyChartRef.current, rsiChartRef.current, ratioChartRef.current].filter(Boolean).forEach((chart) => {
      chart.setActiveElements([]); chart.tooltip?.setActiveElements([], { x: 0, y: 0 }); chart.update('none')
    })
  }

  const buildOptions = (base) => ({
    ...base,
    plugins: { ...base.plugins, syncCrosshair: true },
    scales: {
      ...base.scales,
      x: {
        ...base.scales.x,
        min: zoomRange ? zoomRange.start : undefined,
        max: zoomRange ? zoomRange.end : undefined,
      },
      y: base.scales.y,
    },
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

  const priceChange = openPrice != null && latestPrice != null ? latestPrice - openPrice : null
  const isPositive = priceChange != null && priceChange >= 0

  return (
    <div style={styles.wrap}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerRow}>
          <button style={styles.backBtn} onClick={() => navigate('/')}>
            <FontAwesomeIcon icon={faChevronLeft} />
          </button>
          <div>
            <span style={styles.stockName}>{selectedStock.symbol}</span>
            <span style={styles.symbolText}>{selectedStock.displayName || '—'}</span>
          </div>
        </div>
        <div style={styles.headerRight}>
          <StatusBadges />
          <button style={styles.stockSelector} onClick={() => setSheetOpen(true)}>
            <FontAwesomeIcon icon={faChevronDown} style={styles.chevron} />
          </button>
        </div>
      </div>

      {/* Price display */}
      {latestPrice != null && (
        <div style={styles.priceSection}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-sm)' }}>
            <span style={styles.price}>{latestPrice.toFixed(2)}</span>
            {priceChange != null && (
              <span style={{ ...styles.priceChange, color: isPositive ? 'var(--color-success)' : 'var(--color-danger)' }}>
                {isPositive ? '+' : ''}{priceChange.toFixed(2)}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={styles.chartSettingsBtn} onClick={() => setGuideOpen(true)}>
              <FontAwesomeIcon icon={faCircleQuestion} />
            </button>
            <button style={styles.chartSettingsBtn} onClick={() => setChartSettingsOpen(true)}>
              <FontAwesomeIcon icon={faSliders} />
            </button>
          </div>
        </div>
      )}

      {isDisconnected && (
        <div style={styles.errorCard}>
          <FontAwesomeIcon icon={faPlugCircleXmark} style={{ fontSize: '2rem', color: 'var(--color-danger)', marginBottom: '12px' }} />
          <p style={{ fontSize: 'var(--font-body)', fontWeight: 600, color: 'var(--color-text)' }}>Unable to connect</p>
          <p style={{ fontSize: 'var(--font-footnote)', color: 'var(--color-text-muted)', marginTop: '4px' }}>Live data server is not reachable</p>
        </div>
      )}

      {!isDisconnected && (
        <>
          <BottomSheet title="Select Stock" isOpen={sheetOpen} onClose={() => { setSheetOpen(false); setSheetSearch('') }}>
            <div style={styles.sheetSearchWrap}>
              <input
                style={styles.sheetSearchInput}
                type="text"
                placeholder="Search stocks..."
                value={sheetSearch}
                onChange={(e) => setSheetSearch(e.target.value)}
                autoFocus
              />
            </div>
            {[...stocks].filter((s) => {
              if (!sheetSearch) return true
              const q = sheetSearch.toLowerCase()
              return s.symbol.toLowerCase().includes(q) || (s.displayName || '').toLowerCase().includes(q)
            }).sort((a, b) => {
              if (a.isFavorite && !b.isFavorite) return -1;
              if (!a.isFavorite && b.isFavorite) return 1;
              return a.symbol.localeCompare(b.symbol);
            }).map((stock) => {
              const info = getPriceInfo(stock.instrumentKey)
              return (
                <div
                  key={stock.instrumentKey}
                  style={{ ...styles.sheetItem, background: stock.instrumentKey === selectedInstrumentKey ? 'var(--color-primary-light)' : 'transparent' }}
                >
                  <div style={{ flex: 1, minWidth: 0 }} onClick={() => { unsubscribeStock(selectedInstrumentKey); selectStock(stock.instrumentKey); subscribeStock(stock.instrumentKey); navigate(`/live/${stock.symbol}`, { replace: true }); setSheetOpen(false) }}>
                    <div style={{ fontSize: 'var(--font-body)', fontWeight: 500, color: 'var(--color-text)', textAlign: 'left' }}>{stock.symbol}</div>
                    <div style={{ fontSize: 'var(--font-footnote)', color: 'var(--color-text-muted)', marginTop: '2px', textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{stock.displayName || '—'}</div>
                  </div>
                  {info && (
                    <div style={{ textAlign: 'right' }} onClick={() => { unsubscribeStock(selectedInstrumentKey); selectStock(stock.instrumentKey); subscribeStock(stock.instrumentKey); navigate(`/live/${stock.symbol}`, { replace: true }); setSheetOpen(false) }}>
                      <div style={{ fontSize: 'var(--font-body)', fontWeight: 600, color: info.change >= 0 ? 'var(--color-success)' : 'var(--color-danger)', fontVariantNumeric: 'tabular-nums' }}>
                        {info.price.toFixed(2)}
                      </div>
                      <div style={{ fontSize: 'var(--font-caption)', fontWeight: 500, color: info.change >= 0 ? 'var(--color-success)' : 'var(--color-danger)', fontVariantNumeric: 'tabular-nums', marginTop: '1px' }}>
                        {info.change >= 0 ? '+' : ''}{info.change.toFixed(2)}
                      </div>
                    </div>
                  )}
                  <button style={styles.sheetStar} onClick={() => toggleFavorite(stock.symbol)}>
                    <FontAwesomeIcon icon={stock.isFavorite ? faStarSolid : faStarOutline} style={{ color: stock.isFavorite ? 'var(--color-warning)' : 'var(--color-text-tertiary)' }} />
                  </button>
                </div>
              )
            })}
          </BottomSheet>

          <BottomSheet title="Charts" isOpen={chartSettingsOpen} onClose={() => setChartSettingsOpen(false)}>
            {[
              { key: 'price', label: 'Price Chart' },
              { key: 'pressure', label: 'Sell Pressure' },
              { key: 'volume', label: 'Buy vs Sell Volume' },
              { key: 'rsi', label: 'B/S Ratio RSI' },
              { key: 'ratio', label: 'Buy / Sell Ratio' },
            ].map(({ key, label }) => (
              <div key={key} style={styles.toggleRow} onClick={() => setVisibleCharts((prev) => { const next = { ...prev, [key]: !prev[key] }; localStorage.setItem('liveTicksVisibleCharts', JSON.stringify(next)); return next })}>
                <span style={styles.toggleLabel}>{label}</span>
                <div style={{ ...styles.toggle, background: visibleCharts[key] ? 'var(--color-primary)' : 'var(--color-text-tertiary)' }}>
                  <div style={{ ...styles.toggleKnob, transform: visibleCharts[key] ? 'translateX(16px)' : 'translateX(0)' }} />
                </div>
              </div>
            ))}
          </BottomSheet>

          <BottomSheet title="Trading Guide" isOpen={guideOpen} onClose={() => setGuideOpen(false)}>
            <div style={styles.guideContent}>
              <div style={styles.guideSection}>
                <div style={styles.guideSectionTitle}>When to BUY (Go Long)</div>
                <div style={styles.guideItem}>Price drops to the lower Bollinger Band AND RSI is below 30 — buyers stepping in, bounce likely</div>
                <div style={styles.guideItem}>Bands get very narrow (squeeze), then price pops upward AND RSI is above 50 — new uptrend starting</div>
              </div>
              <div style={styles.guideSection}>
                <div style={styles.guideSectionTitle}>When to SELL (Go Short)</div>
                <div style={styles.guideItem}>Price rises to the upper Bollinger Band AND RSI is above 70 — sellers stepping in, drop likely</div>
                <div style={styles.guideItem}>Bands get very narrow (squeeze), then price drops AND RSI is below 50 — new downtrend starting</div>
              </div>
              <div style={styles.guideSection}>
                <div style={styles.guideSectionTitle}>When to EXIT</div>
                <div style={styles.guideItem}>Long position: exit when price reaches the middle band (SMA). Stop loss if price falls below the lower band.</div>
                <div style={styles.guideItem}>Short position: exit when price reaches the middle band. Stop loss if price rises above the upper band.</div>
              </div>
              <div style={styles.guideSection}>
                <div style={styles.guideSectionTitle}>When to do NOTHING</div>
                <div style={styles.guideItem}>Price is in the middle of the bands, RSI is between 40-60 — no clear direction, wait for a setup</div>
              </div>
              <div style={styles.guideSection}>
                <div style={styles.guideSectionTitle}>High Conviction: Squeeze Breakout</div>
                <div style={styles.guideItem}>1. Bands become very tight (low volatility)</div>
                <div style={styles.guideItem}>2. Price moves sharply in one direction</div>
                <div style={styles.guideItem}>3. RSI confirms (above 50 for up, below 50 for down)</div>
                <div style={styles.guideItem}>4. B/S ratio confirms (above 1 for up, below 1 for down)</div>
              </div>
            </div>
          </BottomSheet>

          <div onTouchMove={handlePinch} onTouchEnd={handlePinchEnd} onTouchCancel={handlePinchEnd}>
          {/* Price chart */}
          {visibleCharts.price && (
            <div style={styles.chartSection}>
              <div style={styles.chartLabel}>Live</div>
              <div style={styles.chartViewport}>
                <Line ref={priceChartRef} data={priceChartData} options={buildOptions(priceChartOptions)} plugins={[syncCrosshairPlugin, pulsingDotPlugin]} />
              </div>
            </div>
          )}

          {/* B/S Ratio RSI chart */}
          {visibleCharts.rsi && (
            <div style={styles.chartSection}>
              <div style={styles.chartLabelRow}>
                <div style={styles.chartLabel}>B/S Ratio RSI (14)</div>
                {(() => { const d = rsiChartData.datasets?.[0]?.data; const v = d && d.findLast((x) => x != null); return v != null ? <span style={{ ...styles.chartValue, color: v > 70 ? 'var(--color-danger)' : v < 30 ? 'var(--color-success)' : 'var(--color-text-muted)' }}>{v.toFixed(1)}</span> : null })()}
              </div>
              <div style={{ ...styles.chartViewport, height: '18vh', minHeight: '100px' }}>
                <Line ref={rsiChartRef} data={rsiChartData} options={buildOptions(rsiChartOptions)} plugins={[syncCrosshairPlugin, rsiZonePlugin, pulsingDotPlugin]} />
              </div>
            </div>
          )}

          {/* B/S Ratio chart */}
          {visibleCharts.ratio && (
            <div style={styles.chartSection}>
              <div style={styles.chartLabelRow}>
                <div style={styles.chartLabel}>Buy / Sell Ratio</div>
                {(() => { const d = ratioChartData.datasets?.[0]?.data; const v = d && d.findLast((x) => x != null); return v != null ? <span style={{ ...styles.chartValue, color: v > 1 ? 'var(--color-success)' : v < 1 ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>{v.toFixed(3)}</span> : null })()}
              </div>
              <div style={{ ...styles.chartViewport, height: '18vh', minHeight: '100px' }}>
                <Line ref={ratioChartRef} data={ratioChartData} options={buildOptions(ratioChartOptions)} plugins={[syncCrosshairPlugin, ratioOneLinePlugin, pulsingDotPlugin]} />
              </div>
            </div>
          )}

          {/* Pressure chart */}
          {visibleCharts.pressure && (
            <div style={styles.chartSection}>
              <div style={styles.chartLabel}>Sell Pressure</div>
              <div style={{ ...styles.chartViewport, height: '18vh', minHeight: '100px' }}>
                <Line ref={pressureChartRef} data={pressureChartData} options={buildOptions(pressureChartOptions)} plugins={[syncCrosshairPlugin, zeroLinePlugin, pulsingDotPlugin]} />
              </div>
            </div>
          )}

          {/* Qty chart */}
          {visibleCharts.volume && (
            <div style={styles.chartSection}>
              <div style={styles.chartLabel}>Buy vs Sell Volume</div>
              <div style={styles.chartViewport}>
                <Line ref={qtyChartRef} data={qtyChartData} options={buildOptions(baseChartOptions)} plugins={[syncCrosshairPlugin, pulsingDotPlugin]} />
              </div>
            </div>
          )}
          </div>
        </>
      )}
    </div>
  )
}

const styles = {
  wrap: {
    paddingTop: 'var(--space-lg)',
    paddingBottom: '80px',
    background: 'var(--color-bg)',
    minHeight: '100vh',
  },
  header: {
    padding: '0 var(--space-xl)',
    marginBottom: 'var(--space-sm)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
  },
  backBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    border: 'none',
    background: 'transparent',
    color: 'var(--color-primary)',
    fontSize: '1.1rem',
    cursor: 'pointer',
    padding: 0,
  },
  stockSelector: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '8px',
  },
  stockName: {
    display: 'block',
    fontSize: 'var(--font-title2)',
    fontWeight: 700,
    color: 'var(--color-text)',
    letterSpacing: '-0.3px',
  },
  chevron: {
    fontSize: '0.85rem',
    color: 'var(--color-text-muted)',
  },
  symbolText: {
    display: 'block',
    fontSize: 'var(--font-footnote)',
    color: 'var(--color-text-muted)',
    marginTop: '2px',
  },
  priceSection: {
    padding: '0 var(--space-xl)',
    marginBottom: 'var(--space-lg)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chartSettingsBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    border: 'none',
    background: 'var(--color-primary-light)',
    color: 'var(--color-primary)',
    fontSize: '0.9rem',
    cursor: 'pointer',
    padding: 0,
  },
  price: {
    fontSize: 'var(--font-title1)',
    fontWeight: 600,
    color: 'var(--color-text)',
    letterSpacing: '-0.5px',
  },
  priceChange: {
    fontSize: 'var(--font-subhead)',
    fontWeight: 600,
  },
  errorCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '40px var(--space-xl)',
    textAlign: 'center',
  },
  chartSection: {
    marginBottom: 'var(--space-lg)',
    background: 'var(--color-card)',
    borderRadius: 'var(--radius-md)',
    marginLeft: 'var(--space-lg)',
    marginRight: 'var(--space-lg)',
    padding: 'var(--space-lg) var(--space-md)',
  },
  chartLabelRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 'var(--space-sm)',
  },
  chartLabel: {
    fontSize: 'var(--font-caption)',
    fontWeight: 600,
    color: 'var(--color-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  chartValue: {
    fontSize: 'var(--font-caption)',
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
  },
  chartViewport: {
    position: 'relative',
    height: '28vh',
    maxHeight: '240px',
    minHeight: '140px',
  },
  sheetItem: {
    width: '100%',
    padding: '14px var(--space-xl)',
    border: 'none',
    borderBottom: '1px solid var(--color-border)',
    textAlign: 'left',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-md)',
  },
  sheetStar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    flexShrink: 0,
    fontSize: '0.9rem',
    padding: 0,
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px var(--space-xl)',
    borderBottom: '1px solid var(--color-border)',
    cursor: 'pointer',
  },
  toggleLabel: {
    fontSize: 'var(--font-body)',
    fontWeight: 500,
    color: 'var(--color-text)',
  },
  toggle: {
    width: '40px',
    height: '24px',
    borderRadius: '12px',
    padding: '2px',
    transition: 'background 0.2s',
  },
  toggleKnob: {
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    background: '#fff',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
    transition: 'transform 0.2s',
  },
  sheetSearchWrap: {
    padding: '0 var(--space-xl) 12px',
    position: 'sticky',
    top: 0,
    background: 'var(--color-card)',
    zIndex: 1,
  },
  sheetSearchInput: {
    width: '100%',
    padding: '10px 14px',
    fontSize: 'var(--font-body)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    outline: 'none',
    boxSizing: 'border-box',
  },
  guideContent: {
    padding: '8px var(--space-xl) 24px',
  },
  guideSection: {
    marginBottom: '20px',
  },
  guideSectionTitle: {
    fontSize: 'var(--font-subhead)',
    fontWeight: 700,
    color: 'var(--color-text)',
    marginBottom: '8px',
  },
  guideItem: {
    fontSize: 'var(--font-footnote)',
    color: 'var(--color-text-muted)',
    lineHeight: 1.5,
    paddingLeft: '12px',
    borderLeft: '2px solid var(--color-border)',
    marginBottom: '6px',
  },
}

import { useEffect, useMemo, useRef, useState } from 'react'
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
import { faPlugCircleXmark, faChevronLeft, faChevronDown } from '@fortawesome/free-solid-svg-icons'
import moment from 'moment'
import BottomSheet from '../components/BottomSheet'
import Loader from '../components/Loader'
import { useApp, isMarketOpen } from '../context/AppContext'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Title, Tooltip, Legend)


// ─── Chart Plugins ──────────────────────────────────────────────

const pulsingDotPlugin = {
  id: 'pulsingDot',
  afterDatasetsDraw(chart) {
    const { ctx, chartArea } = chart
    if (!chartArea) return
    const marketOpen = isMarketOpen()
    const time = Date.now() / 1000
    const alpha = marketOpen ? (0.6 + 0.4 * Math.sin(time * 6)) : 0.5
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

      const color = marketOpen
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

// ─── Sub-components ──────────────────────────────────────────────


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
  const { status, stocks, selectedInstrumentKey, rowsByMinute, sortOrder, selectStock, getPriceInfo } = useApp()
  const [secondsElapsed, setSecondsElapsed] = useState(moment().seconds())
  const [sheetOpen, setSheetOpen] = useState(false)
  const priceChartRef = useRef(null)
  const pressureChartRef = useRef(null)
  const qtyChartRef = useRef(null)

  useEffect(() => {
    if (symbol && stocks.length > 0) {
      const match = stocks.find((s) => s.symbol === symbol)
      if (match) selectStock(match.instrumentKey)
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
    const marketOpen = isMarketOpen()
    const isPositive = openPrice != null && latestPrice != null && latestPrice >= openPrice
    const lineColor = !marketOpen ? '#8e8e93' : openPrice == null ? '#007aff' : (isPositive ? '#34c759' : '#ff3b30')
    const fillRgb = !marketOpen ? '142, 142, 147' : (isPositive ? '52, 199, 89' : '255, 59, 48')

    return {
      labels: FIXED_LABELS,
      datasets: [{
        label: 'Close Price',
        data: rows.map((r) => r ? r.close : null),
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
      }],
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

    const marketOpen = isMarketOpen()
    const buyColor = marketOpen ? '#34c759' : '#8e8e93'
    const sellColor = marketOpen ? '#ff3b30' : '#8e8e93'
    const buyRgb = marketOpen ? '52, 199, 89' : '142, 142, 147'
    const sellRgb = marketOpen ? '255, 59, 48' : '142, 142, 147'

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
    const marketOpen = isMarketOpen()
    const diffs = rows.map((r) => r ? (r.sellQtySum || 0) - (r.buyQtySum || 0) : null)
    const validDiffs = diffs.filter((d) => d != null)
    const maxAbs = Math.max(1, ...validDiffs.map(Math.abs))
    const tanhValues = diffs.map((d) => d != null ? Math.tanh(d / (maxAbs * 0.05)) : null)

    const sellC = marketOpen ? 'rgba(255, 59, 48' : 'rgba(142, 142, 147'
    const buyC = marketOpen ? 'rgba(52, 199, 89' : 'rgba(142, 142, 147'

    return {
      labels: FIXED_LABELS,
      datasets: [{
        label: 'tanh(S−B)',
        data: tanhValues,
        rawDiffs: diffs,
        segment: { borderColor: (ctx) => marketOpen ? (ctx.p0.parsed.y >= 0 ? '#ff3b30' : '#34c759') : '#8e8e93' },
        borderColor: marketOpen ? '#ff3b30' : '#8e8e93',
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
            <span style={styles.stockName}>{selectedStock.displayName}</span>
            <div style={styles.statusRow}>
              <span style={{
                ...styles.dot,
                background: !isMarketOpen() ? 'var(--color-text-tertiary)'
                  : status === 'connected' ? 'var(--color-success)'
                  : status === 'reconnecting' ? 'var(--color-warning)'
                  : 'var(--color-text-tertiary)',
                animation: isMarketOpen() ? 'pulse-dot 2s ease-in-out infinite' : 'none',
              }} />
              <span style={styles.symbolText}>{selectedStock.symbol}</span>
            </div>
          </div>
        </div>
        <button style={styles.stockSelector} onClick={() => setSheetOpen(true)}>
          <FontAwesomeIcon icon={faChevronDown} style={styles.chevron} />
        </button>
      </div>

      {/* Price display */}
      {latestPrice != null && (
        <div style={styles.priceSection}>
          <span style={styles.price}>{latestPrice.toFixed(2)}</span>
          {priceChange != null && (
            <span style={{ ...styles.priceChange, color: isPositive ? 'var(--color-success)' : 'var(--color-danger)' }}>
              {isPositive ? '+' : ''}{priceChange.toFixed(2)}
            </span>
          )}
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
          <BottomSheet title="Select Stock" isOpen={sheetOpen} onClose={() => setSheetOpen(false)}>
            {[...stocks].sort((a, b) => {
              if (sortOrder.length === 0) return 0
              const ai = sortOrder.indexOf(a.symbol)
              const bi = sortOrder.indexOf(b.symbol)
              const aIdx = ai === -1 ? Infinity : ai
              const bIdx = bi === -1 ? Infinity : bi
              return aIdx - bIdx
            }).map((stock) => {
              const info = getPriceInfo(stock.instrumentKey)
              return (
                <button
                  key={stock.instrumentKey}
                  onClick={() => { selectStock(stock.instrumentKey); navigate(`/live/${stock.symbol}`, { replace: true }); setSheetOpen(false) }}
                  style={{ ...styles.sheetItem, background: stock.instrumentKey === selectedInstrumentKey ? 'var(--color-primary-light)' : 'transparent' }}
                >
                  <div>
                    <div style={{ fontSize: 'var(--font-body)', color: 'var(--color-text)', textAlign: 'left' }}>{stock.displayName}</div>
                    <div style={{ fontSize: 'var(--font-caption)', color: 'var(--color-text-muted)', marginTop: '2px', textAlign: 'left' }}>{stock.symbol}</div>
                  </div>
                  {info && (
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 'var(--font-body)', fontWeight: 600, color: info.change >= 0 ? 'var(--color-success)' : 'var(--color-danger)', fontVariantNumeric: 'tabular-nums' }}>
                        {info.price.toFixed(2)}
                      </div>
                      <div style={{ fontSize: 'var(--font-caption)', fontWeight: 500, color: info.change >= 0 ? 'var(--color-success)' : 'var(--color-danger)', fontVariantNumeric: 'tabular-nums', marginTop: '1px' }}>
                        {info.change >= 0 ? '+' : ''}{info.change.toFixed(2)}
                      </div>
                    </div>
                  )}
                </button>
              )
            })}
          </BottomSheet>

          {/* Price chart */}
          <div style={styles.chartSection}>
            <div style={styles.chartLabel}>Live</div>
            <div style={styles.chartViewport}>
              <Line ref={priceChartRef} data={priceChartData} options={buildOptions(baseChartOptions)} plugins={[syncCrosshairPlugin, pulsingDotPlugin]} />
            </div>
          </div>

          {/* Pressure chart */}
          <div style={styles.chartSection}>
            <div style={styles.chartLabel}>Sell Pressure</div>
            <div style={{ ...styles.chartViewport, height: '18vh', minHeight: '100px' }}>
              <Line ref={pressureChartRef} data={pressureChartData} options={buildOptions(pressureChartOptions)} plugins={[syncCrosshairPlugin, zeroLinePlugin, pulsingDotPlugin]} />
            </div>
          </div>

          {/* Qty chart */}
          <div style={styles.chartSection}>
            <div style={styles.chartLabel}>Buy vs Sell Volume</div>
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
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginTop: '4px',
  },
  dot: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
  },
  symbolText: {
    fontSize: 'var(--font-footnote)',
    color: 'var(--color-text-muted)',
  },
  priceSection: {
    padding: '0 var(--space-xl)',
    marginBottom: 'var(--space-lg)',
    display: 'flex',
    alignItems: 'baseline',
    gap: 'var(--space-sm)',
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
  chartLabel: {
    fontSize: 'var(--font-caption)',
    fontWeight: 600,
    color: 'var(--color-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: 'var(--space-sm)',
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
    justifyContent: 'space-between',
  },
}

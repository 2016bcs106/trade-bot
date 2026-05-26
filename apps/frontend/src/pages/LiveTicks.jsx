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

const WS_URL = import.meta.env.VITE_LIVE_TICKS_WS_URL || 'ws://ec2-13-235-76-118.ap-south-1.compute.amazonaws.com:8081/live-ticks'

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

export default function LiveTicks() {
  const [status, setStatus] = useState('connecting')
  const [rowsByMinute, setRowsByMinute] = useState({})
  const wsRef = useRef(null)
  const priceChartRef = useRef(null)
  const qtyChartRef = useRef(null)

  useEffect(() => {
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => setStatus('connected')
    ws.onclose = () => setStatus('disconnected')
    ws.onerror = () => setStatus('error')

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)

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

  const qtyChartData = useMemo(() => ({
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
        label: 'Buy/Sell Ratio',
        data: rows.map((r) => r.buySellRatio),
        borderColor: '#a855f7',
        yAxisID: 'ratioAxis',
        hidden: true,
      },
    ],
  }), [labels, rows])

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
        <h3 style={styles.chartTitle}>Aggregated Buy vs Sell Quantities</h3>
        <div style={styles.chartViewport}>
          <Line ref={qtyChartRef} data={qtyChartData} options={buildOptions(quantityChartOptions)} plugins={[syncCrosshairPlugin]} />
        </div>
      </div>
    </div>
  )
}
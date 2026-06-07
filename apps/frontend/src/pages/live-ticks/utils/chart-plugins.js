let _marketOpen = false

export function setMarketOpen(value) {
  _marketOpen = value
}

export const pulsingDotPlugin = {
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

export const syncCrosshairPlugin = {
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

export const zeroLinePlugin = {
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

export const rsiZonePlugin = {
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

export const ratioOneLinePlugin = {
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

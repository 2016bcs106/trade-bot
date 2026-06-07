export const baseChartOptions = {
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
        callback: function (value) {
          const label = this.getLabelForValue(value)
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

export const priceChartOptions = {
  ...baseChartOptions,
  plugins: {
    ...baseChartOptions.plugins,
    tooltip: {
      ...baseChartOptions.plugins.tooltip,
      filter: (item) => item.dataset.label === 'Close Price',
    },
  },
}

export const pressureChartOptions = {
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

export const rsiChartOptions = {
  ...baseChartOptions,
  scales: {
    ...baseChartOptions.scales,
    y: { display: false, min: 0, max: 100 },
  },
}

export const ratioChartOptions = {
  ...baseChartOptions,
  scales: {
    ...baseChartOptions.scales,
    y: { display: false },
  },
}

export function syncChartsAtIndex(chartRefs, sourceChart, index) {
  const charts = chartRefs.map((r) => r.current).filter((c) => c && c.ctx)
  const sourceLabel = sourceChart?.data?.labels?.[index]
  charts.forEach((target) => {
    try {
      if (sourceLabel == null) { target.setActiveElements([]); target.tooltip?.setActiveElements([], { x: 0, y: 0 }); target.update('none'); return }
      const mappedIndex = target.data.labels.indexOf(sourceLabel)
      if (mappedIndex >= 0) {
        const elements = target.data.datasets.map((_, di) => ({ datasetIndex: di, index: mappedIndex }))
        target.setActiveElements(elements)
        target.tooltip?.setActiveElements(elements, { x: 0, y: 0 })
      } else {
        target.setActiveElements([]); target.tooltip?.setActiveElements([], { x: 0, y: 0 })
      }
      target.update('none')
    } catch {}
  })
}

export function clearSyncedHover(chartRefs) {
  chartRefs.map((r) => r.current).filter((c) => c && c.ctx).forEach((chart) => {
    try { chart.setActiveElements([]); chart.tooltip?.setActiveElements([], { x: 0, y: 0 }); chart.update('none') } catch {}
  })
}

export function buildOptions(base, xRange, chartRefs) {
  return {
    ...base,
    plugins: { ...base.plugins, syncCrosshair: true },
    scales: {
      ...base.scales,
      x: {
        ...base.scales.x,
        min: xRange?.min,
        max: xRange?.max,
        ticks: {
          ...base.scales.x.ticks,
          callback: function (value) {
            const label = this.getLabelForValue(value)
            if (!label) return null
            const [h, m] = label.split(':').map(Number)
            const interval = xRange ? 30 : 60
            return (h * 60 + m) % interval === 0 ? label : null
          },
        },
      },
      y: base.scales.y,
    },
    onHover: (event, elements, chart) => {
      if (!elements.length) { clearSyncedHover(chartRefs); return }
      syncChartsAtIndex(chartRefs, chart, elements[0].index)
    },
  }
}

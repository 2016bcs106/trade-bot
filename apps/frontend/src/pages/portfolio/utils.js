export function formatSigned(value, decimals = 2) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}`
}

export function changeColor(value) {
  return value >= 0 ? 'var(--color-success)' : 'var(--color-danger)'
}

export function changeBgColor(value) {
  return value >= 0 ? 'var(--color-success-light)' : 'var(--color-danger-light)'
}

export function formatCurrency(value, decimals = 2) {
  return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}

export function formatSignedCurrency(value, decimals = 2) {
  const sign = value >= 0 ? '+' : '-'
  return `${sign}₹${Math.abs(value).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}

export function holdingsCardProps(summary) {
  return {
    value: summary.currentValue,
    change: { value: summary.dayChange, pct: summary.dayChangePct, label: 'Today' },
    secondaryStats: [
      { label: 'Invested', value: formatCurrency(summary.investedValue) },
      { label: 'Stocks', value: summary.totalStocks },
    ],
  }
}

export function positionsCardProps(summary) {
  const pnlPct = summary.investedValue !== 0 ? (summary.netPnl / summary.investedValue) * 100 : 0
  return {
    value: summary.currentValue,
    change: { value: summary.netPnl, pct: pnlPct, label: 'P&L' },
    secondaryStats: [
      { label: 'Invested', value: formatCurrency(summary.investedValue) },
      { label: 'Stocks', value: summary.totalStocks },
    ],
  }
}

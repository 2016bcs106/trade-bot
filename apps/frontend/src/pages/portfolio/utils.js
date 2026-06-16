export function formatSigned(value, decimals = 2) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}`
}

export function changeColor(value) {
  return value >= 0 ? 'var(--color-success)' : 'var(--color-danger)'
}

export function formatCurrency(value, decimals = 2) {
  return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}

export function formatCurrencyCompact(value) {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 1_00_00_000) return `${sign}₹${(abs / 1_00_00_000).toFixed(2)} Cr`
  if (abs >= 1_00_000) return `${sign}₹${(abs / 1_00_000).toFixed(2)} L`
  return `${sign}₹${abs.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

export function formatSignedCurrencyCompact(value) {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${formatCurrencyCompact(value)}`
}

export function holdingsCardProps(summary) {
  const totalReturn = summary.currentValue - summary.investedValue
  const totalReturnPct = summary.investedValue !== 0 ? (totalReturn / summary.investedValue) * 100 : 0
  return {
    currentValue: summary.currentValue,
    stockCount: summary.totalStocks,
    stockLabel: 'stocks',
    left: { label: 'Total Return', value: totalReturn, pct: totalReturnPct },
    right: { label: 'Today', value: summary.dayChange, pct: summary.dayChangePct },
  }
}

export function positionsCardProps(summary) {
  const pnlPct = summary.investedValue !== 0 ? (summary.netPnl / summary.investedValue) * 100 : 0
  return {
    currentValue: summary.currentValue,
    stockCount: summary.totalStocks,
    stockLabel: 'positions',
    left: { label: 'Net P&L', value: summary.netPnl, pct: pnlPct },
    right: { label: 'Invested', value: summary.investedValue },
  }
}

export function formatSigned(value, decimals = 2) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}`
}

export function changeColor(value) {
  return value >= 0 ? 'var(--color-success)' : 'var(--color-danger)'
}

export function formatCurrency(value, decimals = 2) {
  return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}

export function formatSignedCurrency(value, decimals = 2) {
  const sign = value >= 0 ? '+' : '-'
  return `${sign}₹${Math.abs(value).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}

export function holdingsCardProps(summary) {
  const totalReturn = summary.currentValue - summary.investedValue
  const totalReturnPct = summary.investedValue !== 0 ? (totalReturn / summary.investedValue) * 100 : 0
  return {
    value: summary.currentValue,
    changes: [
      { label: 'Today', value: summary.dayChange, pct: summary.dayChangePct },
      { label: 'Total return', value: totalReturn, pct: totalReturnPct },
    ],
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
    changes: [
      { label: 'P&L', value: summary.netPnl, pct: pnlPct },
    ],
    secondaryStats: [
      { label: 'Invested', value: formatCurrency(summary.investedValue) },
      { label: 'Stocks', value: summary.totalStocks },
    ],
  }
}

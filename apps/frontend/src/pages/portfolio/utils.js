export function formatSigned(value, decimals = 2) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}`
}

export function changeColor(value) {
  return value >= 0 ? 'var(--color-success)' : 'var(--color-danger)'
}

export function holdingsStats(summary) {
  return [
    { label: 'Invested', value: summary.investedValue.toFixed(2) },
    { label: 'Current', value: summary.currentValue.toFixed(2) },
    { label: '1D Change', value: `${formatSigned(summary.dayChange)} (${formatSigned(summary.dayChangePct)}%)`, color: changeColor(summary.dayChange) },
    { label: 'Stocks', value: summary.totalStocks },
  ]
}

export function positionsStats(summary) {
  return [
    { label: 'Invested', value: summary.investedValue.toFixed(2) },
    { label: 'Current', value: summary.currentValue.toFixed(2) },
    { label: 'Net P&L', value: formatSigned(summary.netPnl), color: changeColor(summary.netPnl) },
    { label: 'Stocks', value: summary.totalStocks },
  ]
}

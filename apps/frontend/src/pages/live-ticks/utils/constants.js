export const MARKET_START = 9 * 60
export const MARKET_END = 15 * 60 + 30

export const FIXED_LABELS = []
for (let t = MARKET_START; t <= MARKET_END; t++) {
  FIXED_LABELS.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`)
}

export const CHART_CONFIGS = [
  { key: 'price', label: 'Price Chart' },
  { key: 'rsi', label: 'B/S Ratio RSI' },
  { key: 'ratio', label: 'Buy / Sell Ratio' },
  { key: 'pressure', label: 'Sell Pressure' },
  { key: 'volume', label: 'Buy vs Sell Volume' },
]

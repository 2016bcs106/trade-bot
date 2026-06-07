export function computeBsRatioRsi(rows, period = 14) {
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

  if (seedEnd === -1) return rsi

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

  return rsi
}

export interface SignalRow {
  time: string;
  symbol: string;
  signal: string;
  price: number;
  rsi: number | null;
}

export function formatSignalTable(title: string, rows: SignalRow[]): string {
  if (rows.length === 0) return "";

  const symLen = Math.max(6, ...rows.map((r) => r.symbol.length));
  const priceLen = Math.max(8, ...rows.map((r) => r.price.toFixed(2).length));
  const rsiLen = 5;

  let netProfit = 0;
  let position: "long" | "short" | null = null;
  let entryPrice = 0;

  const pnls: (string)[] = [];
  for (const r of rows) {
    if (r.signal === "buy") { position = "long"; entryPrice = r.price; pnls.push(""); }
    else if (r.signal === "sell") { position = "short"; entryPrice = r.price; pnls.push(""); }
    else if (r.signal === "exit") {
      const pnl = position === "long" ? r.price - entryPrice : entryPrice - r.price;
      netProfit += pnl;
      pnls.push((pnl >= 0 ? "+" : "") + pnl.toFixed(2));
      position = null;
    } else {
      pnls.push("");
    }
  }

  if (position != null && rows.length > 0) {
    const lastPrice = rows[rows.length - 1].price;
    netProfit += position === "long" ? lastPrice - entryPrice : entryPrice - lastPrice;
  }

  const plLen = Math.max(5, ...pnls.map((p) => p.length));

  const header = `*${title}*\n\`\`\`\n`
    + `Time   Symbol${" ".repeat(symLen - 6)}  Signal  ${"Price(₹)".padStart(priceLen)}  ${"RSI".padStart(rsiLen)}  ${"P&L".padStart(plLen)}\n`
    + `${"─".repeat(5)}  ${"─".repeat(symLen)}  ${"─".repeat(6)}  ${"─".repeat(priceLen)}  ${"─".repeat(rsiLen)}  ${"─".repeat(plLen)}\n`;

  const body = rows.map((r, i) => {
    const sym = r.symbol.padEnd(symLen);
    const sig = r.signal.toUpperCase().padEnd(6);
    const price = r.price.toFixed(2).padStart(priceLen);
    const rsi = r.rsi != null ? r.rsi.toFixed(2).padStart(rsiLen) : "-".padStart(rsiLen);
    const pl = pnls[i].padStart(plLen);
    return `${r.time}  ${sym}  ${sig}  ${price}  ${rsi}  ${pl}`;
  }).join("\n");

  const profitSign = netProfit >= 0 ? "+" : "";
  const footer = `\nNet P&L: ${profitSign}${netProfit.toFixed(2)}\`\`\``;

  return `${header}${body}${footer}`;
}

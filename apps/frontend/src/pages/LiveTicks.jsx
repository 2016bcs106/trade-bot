import { useEffect, useMemo, useRef, useState } from 'react'

const WS_URL = import.meta.env.VITE_LIVE_TICKS_WS_URL || 'ws://ec2-13-235-76-118.ap-south-1.compute.amazonaws.com:8081/live-ticks'

const styles = {
  wrap: { padding: '1rem', paddingBottom: '5rem' },
  title: { margin: 0, marginBottom: '0.5rem' },
  status: { marginBottom: '1rem', fontSize: '0.9rem', color: 'var(--pm-text-muted)' },
  tableWrap: { overflowX: 'auto', border: '1px solid var(--pm-border)', borderRadius: '8px' },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: '900px' },
  th: { textAlign: 'left', padding: '0.6rem', borderBottom: '1px solid var(--pm-border)', fontSize: '0.8rem' },
  td: { padding: '0.55rem 0.6rem', borderBottom: '1px solid var(--pm-border)', fontSize: '0.8rem' },
}

export default function LiveTicks() {
  const [status, setStatus] = useState('connecting')
  const [rowsByMinute, setRowsByMinute] = useState({})
  const wsRef = useRef(null)

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
            if (item?.minute) next[item.minute] = item
          }
          setRowsByMinute(next)
          return
        }

        if (msg.type === 'minute_update' && msg.data?.minute) {
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
    () => Object.values(rowsByMinute).sort((a, b) => String(b.minute).localeCompare(String(a.minute))),
    [rowsByMinute],
  )

  return (
    <div style={styles.wrap}>
      <h2 style={styles.title}>Live Minute Aggregates</h2>
      <div style={styles.status}>WebSocket: <strong>{status}</strong> ({WS_URL})</div>

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              {['Minute', 'Open', 'High', 'Low', 'Close', 'Ticks', 'Buy Qty Sum', 'Sell Qty Sum', 'Buy/Sell Ratio', 'Last Updated'].map((h) => (
                <th key={h} style={styles.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.minute}>
                <td style={styles.td}>{r.minute}</td>
                <td style={styles.td}>{r.open}</td>
                <td style={styles.td}>{r.high}</td>
                <td style={styles.td}>{r.low}</td>
                <td style={styles.td}>{r.close}</td>
                <td style={styles.td}>{r.tickCount}</td>
                <td style={styles.td}>{r.buyQtySum}</td>
                <td style={styles.td}>{r.sellQtySum}</td>
                <td style={styles.td}>{r.buySellRatio ?? '-'}</td>
                <td style={styles.td}>{r.lastUpdatedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
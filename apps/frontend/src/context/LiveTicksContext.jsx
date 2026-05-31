import { createContext, useContext, useEffect, useRef, useState, useMemo } from 'react'
import moment from 'moment'

const WS_URL = import.meta.env.VITE_LIVE_TICKS_WS_URL || 'wss://trade-bot-ws.duckdns.org:8081/live-ticks'

function getTodayIstDate() {
  return moment().utcOffset('+05:30').format('YYYY-MM-DD')
}

function isCurrentIstDayMinute(minute) {
  if (!minute) return false
  return String(minute).slice(0, 10) === getTodayIstDate()
}

const LiveTicksContext = createContext(null)

export function LiveTicksProvider({ children }) {
  const [status, setStatus] = useState('connecting')
  const [stocks, setStocks] = useState([])
  const [selectedInstrumentKey, setSelectedInstrumentKey] = useState('')
  const [dataByInstrument, setDataByInstrument] = useState({})
  const wsRef = useRef(null)

  useEffect(() => {
    let retryTimer = null
    let intentionalClose = false

    function connect() {
      const ws = new WebSocket(WS_URL)
      wsRef.current = ws
      ws.onopen = () => setStatus('connected')
      ws.onclose = () => {
        if (!intentionalClose) {
          setStatus('reconnecting')
          retryTimer = setTimeout(connect, 3000)
        }
      }
      ws.onerror = () => {}
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'stock_list' && Array.isArray(msg.data)) {
            setStocks(msg.data)
            if (msg.data.length > 0) {
              setSelectedInstrumentKey((prev) => {
                if (prev && msg.data.find((s) => s.instrumentKey === prev)) return prev
                return msg.data[0].instrumentKey
              })
              ws.send(JSON.stringify({ type: 'subscribe_all' }))
            }
            return
          }
          if (msg.type === 'snapshot' && Array.isArray(msg.data)) {
            const instrumentKey = msg.meta?.instrumentKey
            if (!instrumentKey) return
            const next = {}
            for (const item of msg.data) {
              if (item?.minute && isCurrentIstDayMinute(item.minute)) next[item.minute] = item
            }
            setDataByInstrument((prev) => ({ ...prev, [instrumentKey]: next }))
            return
          }
          if (msg.type === 'minute_update' && msg.data?.minute) {
            if (!isCurrentIstDayMinute(msg.data.minute)) return
            const instrumentKey = msg.meta?.instrumentKey || msg.data?.instrumentKey
            if (!instrumentKey) return
            setDataByInstrument((prev) => ({
              ...prev,
              [instrumentKey]: { ...(prev[instrumentKey] || {}), [msg.data.minute]: msg.data },
            }))
            return
          }
          if (msg.type === 'day_reset') setDataByInstrument({})
        } catch {}
      }
    }

    connect()
    return () => { intentionalClose = true; if (retryTimer) clearTimeout(retryTimer); wsRef.current?.close() }
  }, [])

  const selectStock = (instrumentKey) => {
    setSelectedInstrumentKey(instrumentKey)
  }

  const rowsByMinute = useMemo(
    () => dataByInstrument[selectedInstrumentKey] || {},
    [dataByInstrument, selectedInstrumentKey],
  )

  return (
    <LiveTicksContext.Provider value={{ status, stocks, selectedInstrumentKey, rowsByMinute, selectStock }}>
      {children}
    </LiveTicksContext.Provider>
  )
}

export function useLiveTicks() {
  const ctx = useContext(LiveTicksContext)
  if (!ctx) throw new Error('useLiveTicks must be used within LiveTicksProvider')
  return ctx
}

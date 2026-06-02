import { createContext, useContext, useEffect, useRef, useState, useMemo } from 'react'
import moment from 'moment'
import { db, ref, onValue } from '../utils/firebase'

const WS_URL = import.meta.env.VITE_LIVE_TICKS_WS_URL || 'wss://trade-bot-ws.duckdns.org:8081/live-ticks'

function getTodayIstDate() {
  return moment().utcOffset('+05:30').format('YYYY-MM-DD')
}

function isCurrentIstDayMinute(minute) {
  if (!minute) return false
  return String(minute).slice(0, 10) === getTodayIstDate()
}

export function isMarketOpen() {
  const now = moment().utcOffset('+05:30')
  const day = now.day()
  if (day === 0 || day === 6) return false
  const minutes = now.hours() * 60 + now.minutes()
  return minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 30
}

const AppContext = createContext(null)

export function AppProvider({ children }) {
  const [status, setStatus] = useState('connecting')
  const [stocks, setStocks] = useState([])
  const [selectedInstrumentKey, setSelectedInstrumentKey] = useState('')
  const [dataByInstrument, setDataByInstrument] = useState({})
  const [sortOrder, setSortOrder] = useState([])
  const [reversedSort, setReversedSort] = useState(false)
  const [firebaseStocks, setFirebaseStocks] = useState(undefined)
  const [scripts, setScripts] = useState(undefined)
  const [requestQueue, setRequestQueue] = useState([])
  const [failedRequests, setFailedRequests] = useState([])
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
          if (msg.type === 'sort_order' && Array.isArray(msg.data)) {
            setSortOrder(msg.data)
            return
          }
          if (msg.type === 'day_reset') setDataByInstrument({})
        } catch {}
      }
    }

    connect()
    return () => { intentionalClose = true; if (retryTimer) clearTimeout(retryTimer); wsRef.current?.close() }
  }, [])

  useEffect(() => {
    const unsubStocks = onValue(ref(db, 'stocks'), (snap) => setFirebaseStocks(snap.val() || {}))
    const unsubScripts = onValue(ref(db, 'scripts'), (snap) => setScripts(snap.val()))
    const unsubQueue = onValue(ref(db, 'request_queue'), (snap) => {
      const data = snap.val()
      setRequestQueue(data ? Object.entries(data).map(([key, val]) => ({ ...val, _key: key })) : [])
    })
    const unsubFailed = onValue(ref(db, 'failed_requests'), (snap) => {
      const data = snap.val()
      setFailedRequests(data ? Object.entries(data).map(([key, val]) => ({ ...val, _key: key })) : [])
    })
    return () => { unsubStocks(); unsubScripts(); unsubQueue(); unsubFailed() }
  }, [])

  const selectStock = (instrumentKey) => {
    setSelectedInstrumentKey(instrumentKey)
  }

  const rowsByMinute = useMemo(
    () => dataByInstrument[selectedInstrumentKey] || {},
    [dataByInstrument, selectedInstrumentKey],
  )

  const getLatestPrice = (instrumentKey) => {
    const info = getPriceInfo(instrumentKey)
    return info ? info.price : null
  }

  const getPriceInfo = (instrumentKey) => {
    const data = dataByInstrument[instrumentKey]
    if (!data) return null
    const minutes = Object.values(data)
    if (minutes.length === 0) return null
    const sorted = minutes.sort((a, b) => String(a.minute).localeCompare(String(b.minute)))
    const price = sorted[sorted.length - 1].close
    let open = null
    for (const r of sorted) {
      const time = String(r.minute).split('T')[1]?.slice(0, 5) || ''
      if (time >= '09:00') { open = r.close; break }
    }
    if (open == null) open = sorted[0].close
    const change = price - open
    const changePct = open !== 0 ? (change / open) * 100 : 0
    return { price, open, change, changePct }
  }

  return (
    <AppContext.Provider value={{ status, stocks, selectedInstrumentKey, rowsByMinute, dataByInstrument, sortOrder, reversedSort, setReversedSort, firebaseStocks, scripts, requestQueue, failedRequests, selectStock, getLatestPrice, getPriceInfo }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}

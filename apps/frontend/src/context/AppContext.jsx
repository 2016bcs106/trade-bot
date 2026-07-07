import { createContext, useContext, useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { db, ref, onValue } from '../utils/firebase'

const WS_URL = import.meta.env.VITE_LIVE_TICKS_WS_URL || 'wss://trade-bot-ws.duckdns.org:8081/live-ticks'

const AppContext = createContext(null)

export function AppProvider({ children }) {
  const [status, setStatus] = useState('connecting')
  const [stocks, setStocks] = useState([])
  const [selectedInstrumentKey, setSelectedInstrumentKey] = useState('')
  const [dataByInstrument, setDataByInstrument] = useState({})
  const [priceByInstrument, setPriceByInstrument] = useState({})
  const [marketStatus, setMarketStatus] = useState('Closed')
  const [sortBy, setSortBy] = useState(() => {
    try { return localStorage.getItem('stockSortBy') || 'relevance' } catch { return 'relevance' }
  })
  const [sortAsc, setSortAsc] = useState(() => {
    try { return localStorage.getItem('stockSortAsc') === 'true' } catch { return false }
  })
  const [activeTab, setActiveTab] = useState('favorites')
  const [picksFilter, setPicksFilter] = useState('all')
  const [picksBroker, setPicksBroker] = useState('paytm')
  const [scripts, setScripts] = useState(undefined)
  const [requestQueue, setRequestQueue] = useState([])
  const [failedRequests, setFailedRequests] = useState([])
  const [portfolioHoldings, setPortfolioHoldings] = useState(null)
  const [portfolioPositions, setPortfolioPositions] = useState(null)
  const [portfolioFunds, setPortfolioFunds] = useState(null)
  const [dhanHoldings, setDhanHoldings] = useState(null)
  const [dhanPositions, setDhanPositions] = useState(null)
  const [dhanFunds, setDhanFunds] = useState(null)
  const [signalsSummary, setSignalsSummary] = useState(null)
  const [dhanSignalsSummary, setDhanSignalsSummary] = useState(null)
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
            }
            return
          }
          if (msg.type === 'snapshot' && Array.isArray(msg.data)) {
            const instrumentKey = msg.meta?.instrumentKey
            if (!instrumentKey) return
            const next = {}
            for (const item of msg.data) {
              if (item?.minute) next[item.minute] = item
            }
            setDataByInstrument((prev) => ({ ...prev, [instrumentKey]: next }))
            return
          }
          if (msg.type === 'minute_update' && msg.data?.minute) {
            const instrumentKey = msg.meta?.instrumentKey || msg.data?.instrumentKey
            if (!instrumentKey) return
            setDataByInstrument((prev) => ({
              ...prev,
              [instrumentKey]: { ...(prev[instrumentKey] || {}), [msg.data.minute]: msg.data },
            }))
            return
          }
          if (msg.type === 'price_update' && msg.data) {
            const { instrumentKey, price, change, changePct } = msg.data
            setPriceByInstrument((prev) => ({ ...prev, [instrumentKey]: { price, change, changePct } }))
            return
          }
          if (msg.type === 'favorite_prices' && Array.isArray(msg.data)) {
            const next = {}
            for (const item of msg.data) {
              next[item.instrumentKey] = { price: item.price, change: item.change, changePct: item.changePct }
            }
            setPriceByInstrument((prev) => ({ ...prev, ...next }))
            return
          }
          if (msg.type === 'market_status' && msg.data) {
            setMarketStatus(msg.data.status)
            return
          }
          if (msg.type === 'day_reset') {
            setDataByInstrument({})
            setPriceByInstrument({})
          }
        } catch {}
      }
    }

    connect()
    return () => { intentionalClose = true; if (retryTimer) clearTimeout(retryTimer); wsRef.current?.close() }
  }, [])

  useEffect(() => {
    const unsubScripts = onValue(ref(db, 'scripts'), (snap) => setScripts(snap.val()))
    const unsubQueue = onValue(ref(db, 'request_queue'), (snap) => {
      const data = snap.val()
      setRequestQueue(data ? Object.entries(data).map(([key, val]) => ({ ...val, _key: key })) : [])
    })
    const unsubFailed = onValue(ref(db, 'failed_requests'), (snap) => {
      const data = snap.val()
      setFailedRequests(data ? Object.entries(data).map(([key, val]) => ({ ...val, _key: key })) : [])
    })
    const unsubPortfolioHoldings = onValue(ref(db, 'portfolio/holdings'), (snap) => setPortfolioHoldings(snap.val()))
    const unsubPortfolioPositions = onValue(ref(db, 'portfolio/positions'), (snap) => setPortfolioPositions(snap.val()))
    const unsubPortfolioFunds = onValue(ref(db, 'portfolio/funds'), (snap) => setPortfolioFunds(snap.val()))
    const unsubDhanHoldings = onValue(ref(db, 'dhanhq/portfolio/holdings'), (snap) => setDhanHoldings(snap.val()))
    const unsubDhanPositions = onValue(ref(db, 'dhanhq/portfolio/positions'), (snap) => setDhanPositions(snap.val()))
    const unsubDhanFunds = onValue(ref(db, 'dhanhq/portfolio/funds'), (snap) => setDhanFunds(snap.val()))
    const unsubSignalsSummary = onValue(ref(db, 'signals_summary/latest'), (snap) => setSignalsSummary(snap.val()))
    const unsubDhanSignalsSummary = onValue(ref(db, 'dhanhq/signals_summary/latest'), (snap) => setDhanSignalsSummary(snap.val()))
    return () => {
      unsubScripts(); unsubQueue(); unsubFailed()
      unsubPortfolioHoldings(); unsubPortfolioPositions(); unsubPortfolioFunds()
      unsubDhanHoldings(); unsubDhanPositions(); unsubDhanFunds(); unsubSignalsSummary(); unsubDhanSignalsSummary()
    }
  }, [])

  const selectStock = (instrumentKey) => {
    setSelectedInstrumentKey(instrumentKey)
    setDataByInstrument((prev) => ({ ...prev, [instrumentKey]: {} }))
  }

  const subscribeStock = (instrumentKey) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', instrumentKey }))
    }
  }

  const unsubscribeStock = (instrumentKey) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'unsubscribe', instrumentKey }))
    }
  }

  const toggleFavorite = (symbol) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'toggle_favorite', symbol }))
    }
  }

  const toggleNotify = (symbol) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'toggle_notify', symbol }))
    }
  }

  const persistedSetSortBy = useCallback((val) => {
    setSortBy(val)
    try { localStorage.setItem('stockSortBy', val) } catch {}
  }, [])

  const persistedSetSortAsc = useCallback((val) => {
    setSortAsc(val)
    try { localStorage.setItem('stockSortAsc', String(val)) } catch {}
  }, [])

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
    if (data) {
      const minutes = Object.values(data)
      if (minutes.length > 0) {
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
    }
    const cached = priceByInstrument[instrumentKey]
    if (cached) return cached
    return null
  }

  return (
    <AppContext.Provider value={{ status, stocks, selectedInstrumentKey, rowsByMinute, dataByInstrument, marketStatus, sortBy, setSortBy: persistedSetSortBy, sortAsc, setSortAsc: persistedSetSortAsc, activeTab, setActiveTab, picksFilter, setPicksFilter, picksBroker, setPicksBroker, scripts, requestQueue, failedRequests, portfolioHoldings, portfolioPositions, portfolioFunds, dhanHoldings, dhanPositions, dhanFunds, signalsSummary, dhanSignalsSummary, selectStock, subscribeStock, unsubscribeStock, toggleFavorite, toggleNotify, getLatestPrice, getPriceInfo }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}

import { useState, useEffect } from 'react'
import { db, ref, onValue, get, query, orderByKey, endAt } from '../utils/firebase'

const styles = {
  container: { padding: '1rem', paddingBottom: '5rem' },
  sectionTitle: { fontSize: '0.9rem', fontWeight: '700', color: 'var(--pm-text)', marginBottom: '0.75rem', marginTop: '0.5rem' },
  card: {
    background: 'var(--pm-card-bg)',
    borderRadius: '12px',
    border: '1px solid var(--pm-border)',
    padding: '1rem',
    marginBottom: '0.75rem',
  },
  predRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.7rem 0',
    borderBottom: '1px solid var(--pm-border)',
    cursor: 'pointer',
  },
  predRowLast: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.7rem 0',
    cursor: 'pointer',
  },
  symbol: { fontWeight: '700', fontSize: '0.85rem', color: 'var(--pm-text)' },
  subtext: { fontSize: '0.65rem', color: 'var(--pm-text-muted)' },
  predValues: { textAlign: 'right', fontSize: '0.7rem' },
  predHigh: { color: '#22c55e', fontWeight: '600' },
  predLow: { color: '#ef4444', fontWeight: '600' },
  empty: { textAlign: 'center', padding: '2rem', color: 'var(--pm-text-muted)', fontSize: '0.8rem' },
  // Bottom sheet modal
  overlay: {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.6)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  modal: {
    background: 'var(--pm-card-bg)',
    borderRadius: '16px 16px 0 0',
    width: '100%',
    maxWidth: '480px',
    maxHeight: '75vh',
    display: 'flex',
    flexDirection: 'column',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1.25rem 1.25rem 0.75rem',
    borderBottom: '1px solid var(--pm-border)',
    flexShrink: 0,
  },
  modalTitle: { fontSize: '1.1rem', fontWeight: '700', color: 'var(--pm-text)' },
  modalClose: {
    background: 'none', border: 'none', fontSize: '1.5rem',
    color: 'var(--pm-text-muted)', cursor: 'pointer', padding: '0.25rem',
  },
  modalBody: {
    overflow: 'auto',
    padding: '0 1.25rem',
    paddingBottom: '5rem',
    flex: 1,
  },
  histRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.6rem 0',
    borderBottom: '1px solid var(--pm-border)',
  },
  histDate: { fontWeight: '600', fontSize: '0.8rem', color: 'var(--pm-text)' },
  histActual: { fontSize: '0.65rem', color: 'var(--pm-text-muted)' },
  loadingText: { textAlign: 'center', padding: '2rem', color: 'var(--pm-text-muted)', fontSize: '0.8rem' },
}

export default function Dashboard() {
  const [predictions, setPredictions] = useState({})
  const [selectedSymbol, setSelectedSymbol] = useState(null)
  const [history, setHistory] = useState(null)
  const [loadingHistory, setLoadingHistory] = useState(false)

  useEffect(() => {
    const predRef = ref(db, 'predictions')
    const unsub = onValue(predRef, (snap) => setPredictions(snap.val() || {}))
    return () => unsub()
  }, [])

  const today = new Date().toISOString().split('T')[0]

  // Today's predictions across all symbols
  const todayPredictions = Object.entries(predictions).flatMap(([symbol, dates]) => {
    const todayData = dates?.[today]
    if (!todayData) return []
    return [{ symbol, ...todayData }]
  })

  // Open history modal
  const openHistory = async (symbol) => {
    setSelectedSymbol(symbol)
    setHistory(null)
    setLoadingHistory(true)
    try {
      // Load last 30 days of predictions for this symbol
      const predRef = query(
        ref(db, `predictions/${symbol}`),
        orderByKey(),
        endAt(today)
      )
      const snap = await get(predRef)
      const data = snap.val() || {}
      // Sort newest first, limit to last 30
      const entries = Object.entries(data).sort(([a], [b]) => b.localeCompare(a)).slice(0, 30)
      setHistory(entries)
    } catch (e) {
      console.error('Failed to load history:', e)
      setHistory([])
    }
    setLoadingHistory(false)
  }

  return (
    <div style={styles.container}>
      <div style={styles.sectionTitle}>Today's Predictions</div>
      <div style={styles.card}>
        {todayPredictions.length === 0 ? (
          <div style={styles.empty}>No predictions for {today}</div>
        ) : (
          todayPredictions.map((pred, i) => (
            <div
              key={pred.symbol}
              style={i === todayPredictions.length - 1 ? styles.predRowLast : styles.predRow}
              onClick={() => openHistory(pred.symbol)}
            >
              <div>
                <div style={styles.symbol}>{pred.symbol}</div>
                <div style={styles.subtext}>
                  {pred.modelVersion} • {pred.modelType}
                </div>
              </div>
              <div style={styles.predValues}>
                <div style={styles.predHigh}>H: ₹{pred.predictedHigh?.toFixed(2)}</div>
                <div style={styles.predLow}>L: ₹{pred.predictedLow?.toFixed(2)}</div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Historical modal */}
      {selectedSymbol && (
        <div style={styles.overlay} onClick={() => setSelectedSymbol(null)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <span style={styles.modalTitle}>{selectedSymbol} — History</span>
              <button style={styles.modalClose} onClick={() => setSelectedSymbol(null)}>×</button>
            </div>
            <div style={styles.modalBody}>
              {loadingHistory ? (
                <div style={styles.loadingText}>Loading...</div>
              ) : history && history.length === 0 ? (
                <div style={styles.loadingText}>No historical predictions</div>
              ) : history && history.map(([date, pred]) => (
                <div key={date} style={styles.histRow}>
                  <div>
                    <div style={styles.histDate}>{date}</div>
                    <div style={styles.subtext}>{pred.modelVersion} • {pred.modelType}</div>
                  </div>
                  <div style={styles.predValues}>
                    <div style={styles.predHigh}>H: ₹{pred.predictedHigh?.toFixed(2)}</div>
                    <div style={styles.predLow}>L: ₹{pred.predictedLow?.toFixed(2)}</div>
                    {pred.evaluated && pred.actualHigh != null && (
                      <div style={styles.histActual}>
                        Actual: {pred.actualHigh?.toFixed(0)}–{pred.actualLow?.toFixed(0)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Filler, Title, Tooltip, Legend } from 'chart.js'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlugCircleXmark, faChevronLeft, faChevronDown, faSliders, faCircleQuestion, faMaximize, faMinimize } from '@fortawesome/free-solid-svg-icons'
import Loader from '../components/Loader'
import StatusBadges from '../components/StatusBadges'
import { useApp } from '../context/AppContext'
import { FIXED_LABELS } from './live-ticks/utils/constants'
import { chartStyles } from './live-ticks/utils/styles'
import { setMarketOpen } from './live-ticks/utils/chart-plugins'
import { baseChartOptions, priceChartOptions, pressureChartOptions, rsiChartOptions, ratioChartOptions, buildOptions } from './live-ticks/utils/chart-options'
import useRows from './live-ticks/utils/useRows'
import PriceChart from './live-ticks/components/PriceChart'
import RsiChart from './live-ticks/components/RsiChart'
import RatioChart from './live-ticks/components/RatioChart'
import PressureChart from './live-ticks/components/PressureChart'
import VolumeChart from './live-ticks/components/VolumeChart'
import TradingGuide from './live-ticks/components/TradingGuide'
import ChartSettingsSheet from './live-ticks/components/ChartSettingsSheet'
import StockSelectorSheet from './live-ticks/components/StockSelectorSheet'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Title, Tooltip, Legend)

export default function LiveTicks() {
  const { symbol } = useParams()
  const navigate = useNavigate()
  const { status, stocks, selectedInstrumentKey, selectStock, subscribeStock, unsubscribeStock, toggleFavorite, getPriceInfo, marketStatus } = useApp()
  setMarketOpen(marketStatus !== 'Closed')

  const [sheetOpen, setSheetOpen] = useState(false)
  const [chartSettingsOpen, setChartSettingsOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [zoomedIn, setZoomedIn] = useState(true)
  const [visibleCharts, setVisibleCharts] = useState(() => {
    try {
      const saved = localStorage.getItem('liveTicksVisibleCharts')
      if (saved) return JSON.parse(saved)
    } catch {}
    return { price: true, rsi: true, ratio: true, pressure: true, volume: true }
  })

  const priceChartRef = useRef(null)
  const rsiChartRef = useRef(null)
  const ratioChartRef = useRef(null)
  const pressureChartRef = useRef(null)
  const qtyChartRef = useRef(null)
  const chartRefs = [priceChartRef, rsiChartRef, ratioChartRef, pressureChartRef, qtyChartRef]

  const rows = useRows()

  useEffect(() => {
    if (symbol && stocks.length > 0) {
      const match = stocks.find((s) => s.symbol === symbol)
      if (match) {
        selectStock(match.instrumentKey)
        subscribeStock(match.instrumentKey)
      }
    }
    return () => {
      if (symbol && stocks.length > 0) {
        const match = stocks.find((s) => s.symbol === symbol)
        if (match) unsubscribeStock(match.instrumentKey)
      }
    }
  }, [symbol, stocks])

  const xRange = useMemo(() => {
    if (!zoomedIn) return null
    let lastIdx = -1
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i]) { lastIdx = i; break }
    }
    if (lastIdx < 0) return null
    const end = Math.min(lastIdx + 5, FIXED_LABELS.length - 1)
    return { min: Math.max(0, end - 180), max: end }
  }, [rows, zoomedIn])

  const opts = (base) => buildOptions(base, xRange, chartRefs)

  // ─── Render ──────────────────────────────────────────────

  const isDisconnected = status === 'disconnected'
  const selectedStock = stocks.find((s) => s.instrumentKey === selectedInstrumentKey)

  if (!selectedStock) {
    return <div style={styles.wrap}><Loader /></div>
  }

  return (
    <div style={styles.wrap}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerRow}>
          <button style={styles.backBtn} onClick={() => navigate('/')}>
            <FontAwesomeIcon icon={faChevronLeft} />
          </button>
          <div>
            <span style={styles.stockName}>{selectedStock.symbol}</span>
            <span style={styles.symbolText}>{selectedStock.displayName || '—'}</span>
          </div>
        </div>
        <div style={styles.headerRight}>
          <StatusBadges />
          <button style={styles.stockSelector} onClick={() => setSheetOpen(true)}>
            <FontAwesomeIcon icon={faChevronDown} style={styles.chevron} />
          </button>
        </div>
      </div>

      {isDisconnected && (
        <div style={styles.errorCard}>
          <FontAwesomeIcon icon={faPlugCircleXmark} style={{ fontSize: '2rem', color: 'var(--color-danger)', marginBottom: '12px' }} />
          <p style={{ fontSize: 'var(--font-body)', fontWeight: 600, color: 'var(--color-text)' }}>Unable to connect</p>
          <p style={{ fontSize: 'var(--font-footnote)', color: 'var(--color-text-muted)', marginTop: '4px' }}>Live data server is not reachable</p>
        </div>
      )}

      {!isDisconnected && (
        <>
          <StockSelectorSheet
            isOpen={sheetOpen}
            onClose={() => setSheetOpen(false)}
            stocks={stocks}
            selectedInstrumentKey={selectedInstrumentKey}
            getPriceInfo={getPriceInfo}
            onSelectStock={(stock) => { unsubscribeStock(selectedInstrumentKey); selectStock(stock.instrumentKey); subscribeStock(stock.instrumentKey); navigate(`/live/${stock.symbol}`, { replace: true }) }}
            onToggleFavorite={toggleFavorite}
          />

          <ChartSettingsSheet isOpen={chartSettingsOpen} onClose={() => setChartSettingsOpen(false)} visibleCharts={visibleCharts} setVisibleCharts={setVisibleCharts} />
          <TradingGuide isOpen={guideOpen} onClose={() => setGuideOpen(false)} />

          <div>
            <div style={styles.toolbar}>
              <button style={chartStyles.iconBtn} onClick={() => setZoomedIn((v) => !v)}>
                <FontAwesomeIcon icon={zoomedIn ? faMaximize : faMinimize} />
              </button>
              <button style={chartStyles.iconBtn} onClick={() => setGuideOpen(true)}>
                <FontAwesomeIcon icon={faCircleQuestion} />
              </button>
              <button style={chartStyles.iconBtn} onClick={() => setChartSettingsOpen(true)}>
                <FontAwesomeIcon icon={faSliders} />
              </button>
            </div>

            {visibleCharts.price && (
              <div style={chartStyles.section}>
                <PriceChart ref={priceChartRef} options={opts(priceChartOptions)} />
              </div>
            )}

            {visibleCharts.rsi && (
              <div style={chartStyles.section}>
                <RsiChart ref={rsiChartRef} options={opts(rsiChartOptions)} />
              </div>
            )}

            {visibleCharts.ratio && (
              <div style={chartStyles.section}>
                <RatioChart ref={ratioChartRef} options={opts(ratioChartOptions)} />
              </div>
            )}

            {visibleCharts.pressure && (
              <div style={chartStyles.section}>
                <PressureChart ref={pressureChartRef} options={opts(pressureChartOptions)} />
              </div>
            )}

            {visibleCharts.volume && (
              <div style={chartStyles.section}>
                <VolumeChart ref={qtyChartRef} options={opts(baseChartOptions)} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

const styles = {
  wrap: {
    paddingTop: 'var(--space-lg)',
    paddingBottom: '80px',
    background: 'var(--color-bg)',
    minHeight: '100vh',
  },
  header: {
    padding: '0 var(--space-xl)',
    marginBottom: 'var(--space-sm)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
  },
  backBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    border: 'none',
    background: 'transparent',
    color: 'var(--color-primary)',
    fontSize: '1.1rem',
    cursor: 'pointer',
    padding: 0,
  },
  stockSelector: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '8px',
  },
  stockName: {
    display: 'block',
    fontSize: 'var(--font-title2)',
    fontWeight: 700,
    color: 'var(--color-text)',
    letterSpacing: '-0.3px',
  },
  chevron: {
    fontSize: '0.85rem',
    color: 'var(--color-text-muted)',
  },
  symbolText: {
    display: 'block',
    fontSize: 'var(--font-footnote)',
    color: 'var(--color-text-muted)',
    marginTop: '2px',
  },
  errorCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '40px var(--space-xl)',
    textAlign: 'center',
  },
  toolbar: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    padding: '0 var(--space-lg)',
    marginBottom: 'var(--space-sm)',
  },
}

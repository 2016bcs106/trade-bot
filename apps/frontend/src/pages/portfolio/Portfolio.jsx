import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowTrendUp, faArrowTrendDown, faChevronRight } from '@fortawesome/free-solid-svg-icons'
import Page from '../../components/Page'
import PageHeader from '../../components/PageHeader'
import SectionHeader from '../../components/SectionHeader'
import Loader from '../../components/Loader'
import Card from '../../components/Card'
import { useApp } from '../../context/AppContext'
import SummaryCard from './components/SummaryCard'
import FundsCard from './components/FundsCard'
import { holdingsCardProps, positionsCardProps } from './utils'

const BROKERS = [
  { key: 'paytm', label: 'Paytm Money' },
  { key: 'dhan', label: 'Dhan' },
]

export default function Portfolio() {
  const navigate = useNavigate()
  const location = useLocation()
  const [broker, setBroker] = useState(location.state?.broker ?? 'paytm')
  const { portfolioHoldings, portfolioPositions, portfolioFunds, dhanHoldings, dhanPositions, dhanFunds, signalsSummary, setActiveTab, setPicksFilter } = useApp()

  const goToPicks = (filter = 'all') => { setPicksFilter(filter); setActiveTab('recommended'); navigate('/') }

  const dhanSymbols = new Set([
    ...(dhanHoldings?.items ?? []).map((i) => i.symbol),
    ...(dhanPositions?.items ?? []).map((i) => i.symbol),
  ])
  const dhanBuyCount = (signalsSummary?.buySymbols ?? []).filter((s) => !dhanSymbols.has(s)).length
  const dhanSellCount = (signalsSummary?.sellSymbols ?? []).filter((s) => dhanSymbols.has(s)).length

  const makeRecommendationsCard = (buyCount, sellCount) => (
    <Card style={styles.recCard}>
      <div style={styles.recRow} onClick={() => goToPicks('buy')}>
        <div style={{ ...styles.recIcon, background: 'var(--color-success)' }}>
          <FontAwesomeIcon icon={faArrowTrendUp} style={styles.recIconGlyph} />
        </div>
        <span style={styles.recLabel}>Ready to buy</span>
        <span style={styles.recCount}>{buyCount}</span>
        <FontAwesomeIcon icon={faChevronRight} style={styles.recChevron} />
      </div>
      <div style={{ ...styles.recRow, ...styles.recRowBorder }} onClick={() => goToPicks('sell')}>
        <div style={{ ...styles.recIcon, background: 'var(--color-danger)' }}>
          <FontAwesomeIcon icon={faArrowTrendDown} style={styles.recIconGlyph} />
        </div>
        <span style={styles.recLabel}>Ready to sell</span>
        <span style={styles.recCount}>{sellCount}</span>
        <FontAwesomeIcon icon={faChevronRight} style={styles.recChevron} />
      </div>
    </Card>
  )

  const brokerTabs = (
    <div style={styles.tabs}>
      {BROKERS.map((b) => (
        <button
          key={b.key}
          style={{ ...styles.tab, ...(broker === b.key ? styles.tabActive : {}) }}
          onClick={() => setBroker(b.key)}
        >
          {b.label}
        </button>
      ))}
    </div>
  )

  if (broker === 'dhan') {
    if (!dhanHoldings || !dhanPositions) {
      return <Page><PageHeader title="Portfolio" />{brokerTabs}<Loader /></Page>
    }
    return (
      <Page>
        <PageHeader title="Portfolio" />
        {brokerTabs}
        <FundsCard funds={dhanFunds} />
        <SectionHeader>Holdings</SectionHeader>
        <SummaryCard {...holdingsCardProps(dhanHoldings.summary)} onClick={() => navigate('/portfolio/dhan/holdings')} />
        <SectionHeader>Open Positions</SectionHeader>
        <SummaryCard {...positionsCardProps(dhanPositions.summary)} onClick={() => navigate('/portfolio/dhan/positions')} />
        <SectionHeader>Recommendations</SectionHeader>
        {makeRecommendationsCard(dhanBuyCount, dhanSellCount)}
      </Page>
    )
  }

  if (!portfolioHoldings || !portfolioPositions) {
    return <Page><PageHeader title="Portfolio" />{brokerTabs}<Loader /></Page>
  }

  return (
    <Page>
      <PageHeader title="Portfolio" />
      {brokerTabs}
      <FundsCard funds={portfolioFunds} />

      <SectionHeader>Holdings</SectionHeader>
      <SummaryCard
        {...holdingsCardProps(portfolioHoldings.summary)}
        onClick={() => navigate('/portfolio/paytm/holdings')}
      />

      <SectionHeader>Open Positions</SectionHeader>
      <SummaryCard
        {...positionsCardProps(portfolioPositions.summary)}
        onClick={() => navigate('/portfolio/paytm/positions')}
      />

      <SectionHeader>Recommendations</SectionHeader>
      {makeRecommendationsCard(signalsSummary?.buyCount ?? 0, signalsSummary?.sellCount ?? 0)}
    </Page>
  )
}

const styles = {
  tabs: {
    display: 'flex',
    gap: 0,
    marginBottom: 'var(--space-md)',
  },
  tab: {
    flex: 1,
    padding: '10px',
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontSize: 'var(--font-footnote)',
    fontWeight: 500,
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
    textAlign: 'center',
  },
  tabActive: {
    color: 'var(--color-primary)',
    fontWeight: 600,
    boxShadow: 'inset 0 -2px 0 var(--color-primary)',
  },
  recCard: {
    padding: 0,
  },
  recRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-md)',
    padding: '14px var(--space-lg)',
    cursor: 'pointer',
  },
  recRowBorder: {
    borderTop: '1px solid var(--color-border)',
  },
  recIcon: {
    width: '30px',
    height: '30px',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  recIconGlyph: {
    color: '#fff',
    fontSize: '0.8rem',
  },
  recLabel: {
    flex: 1,
    fontSize: 'var(--font-body)',
    color: 'var(--color-text)',
  },
  recCount: {
    fontSize: 'var(--font-title3)',
    fontWeight: 700,
    color: 'var(--color-text)',
    fontVariantNumeric: 'tabular-nums',
  },
  recChevron: {
    fontSize: '0.8rem',
    color: 'var(--color-text-tertiary)',
  },
}

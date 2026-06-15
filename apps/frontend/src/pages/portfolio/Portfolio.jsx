import { useNavigate } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBriefcase, faChartLine, faArrowTrendUp, faArrowTrendDown, faChevronRight } from '@fortawesome/free-solid-svg-icons'
import Page from '../../components/Page'
import PageHeader from '../../components/PageHeader'
import SectionHeader from '../../components/SectionHeader'
import Loader from '../../components/Loader'
import Card from '../../components/Card'
import { useApp } from '../../context/AppContext'
import SummaryCard from './components/SummaryCard'
import { holdingsCardProps, positionsCardProps } from './utils'

export default function Portfolio() {
  const navigate = useNavigate()
  const { portfolioHoldings, portfolioPositions, signalsSummary, setActiveTab } = useApp()

  if (!portfolioHoldings || !portfolioPositions) {
    return <Page><Loader /></Page>
  }

  return (
    <Page>
      <PageHeader title="Portfolio" />

      <SectionHeader>Holdings</SectionHeader>
      <SummaryCard
        icon={faBriefcase}
        iconColor="var(--color-primary)"
        title="Holdings"
        {...holdingsCardProps(portfolioHoldings.summary)}
        onClick={() => navigate('/portfolio/holdings')}
      />

      <SectionHeader>Open Positions</SectionHeader>
      <SummaryCard
        icon={faChartLine}
        iconColor="var(--color-info)"
        title="Open Positions"
        {...positionsCardProps(portfolioPositions.summary)}
        onClick={() => navigate('/portfolio/positions')}
      />

      <SectionHeader>Recommendations</SectionHeader>
      <Card style={styles.recCard} onClick={() => { setActiveTab('recommended'); navigate('/') }}>
        <div style={styles.recRow}>
          <div style={{ ...styles.recIcon, background: 'var(--color-success)' }}>
            <FontAwesomeIcon icon={faArrowTrendUp} style={styles.recIconGlyph} />
          </div>
          <span style={styles.recLabel}>Ready to buy</span>
          <span style={styles.recCount}>{signalsSummary?.buyCount ?? 0}</span>
        </div>
        <div style={{ ...styles.recRow, ...styles.recRowBorder }}>
          <div style={{ ...styles.recIcon, background: 'var(--color-danger)' }}>
            <FontAwesomeIcon icon={faArrowTrendDown} style={styles.recIconGlyph} />
          </div>
          <span style={styles.recLabel}>Ready to sell</span>
          <span style={styles.recCount}>{signalsSummary?.sellCount ?? 0}</span>
        </div>
        <FontAwesomeIcon icon={faChevronRight} style={styles.recChevron} />
      </Card>
    </Page>
  )
}

const styles = {
  recCard: {
    cursor: 'pointer',
    position: 'relative',
    padding: 0,
  },
  recRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-md)',
    padding: '14px var(--space-lg)',
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
    marginRight: 'var(--space-xl)',
  },
  recChevron: {
    position: 'absolute',
    top: '50%',
    right: 'var(--space-lg)',
    transform: 'translateY(-50%)',
    fontSize: '0.8rem',
    color: 'var(--color-text-tertiary)',
  },
}

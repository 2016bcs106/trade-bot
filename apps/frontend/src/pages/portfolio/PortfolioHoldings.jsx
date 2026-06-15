import { useNavigate } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronLeft, faBriefcase } from '@fortawesome/free-solid-svg-icons'
import Page from '../../components/Page'
import Loader from '../../components/Loader'
import EmptyState from '../../components/EmptyState'
import { CardList } from '../../components/Card'
import { useApp } from '../../context/AppContext'
import SummaryCard from './components/SummaryCard'
import HoldingRow from './components/HoldingRow'
import { holdingsStats } from './utils'

export default function PortfolioHoldings() {
  const navigate = useNavigate()
  const { portfolioHoldings } = useApp()

  if (!portfolioHoldings) {
    return <Page><Loader /></Page>
  }

  const { summary, items } = portfolioHoldings

  return (
    <Page>
      <div style={styles.headerRow}>
        <button style={styles.backBtn} onClick={() => navigate('/portfolio')}>
          <FontAwesomeIcon icon={faChevronLeft} />
        </button>
        <h1 style={styles.title}>Holdings</h1>
      </div>

      <SummaryCard title="Holdings" stats={holdingsStats(summary)} />

      {items.length === 0 ? (
        <EmptyState icon={faBriefcase} title="No holdings" subtitle="Your long-term holdings will show up here" />
      ) : (
        <CardList style={styles.list}>
          {items.map((item, i) => (
            <HoldingRow
              key={item.symbol}
              item={item}
              change={{ value: item.dayChange, pct: item.dayChangePct }}
              isLast={i === items.length - 1}
            />
          ))}
        </CardList>
      )}
    </Page>
  )
}

const styles = {
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
    marginBottom: 'var(--space-xl)',
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
  title: {
    fontSize: 'var(--font-largetitle)',
    fontWeight: 700,
    color: 'var(--color-text)',
    letterSpacing: '-0.5px',
  },
  list: {
    marginTop: 'var(--space-md)',
  },
}

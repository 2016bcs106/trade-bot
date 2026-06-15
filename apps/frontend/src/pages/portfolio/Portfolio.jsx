import { useNavigate } from 'react-router-dom'
import Page from '../../components/Page'
import PageHeader from '../../components/PageHeader'
import Loader from '../../components/Loader'
import { useApp } from '../../context/AppContext'
import SummaryCard from './components/SummaryCard'
import { holdingsStats, positionsStats } from './utils'

export default function Portfolio() {
  const navigate = useNavigate()
  const { portfolioHoldings, portfolioPositions, signalsSummary, setActiveTab } = useApp()

  if (!portfolioHoldings || !portfolioPositions) {
    return <Page><Loader /></Page>
  }

  const recommendationStats = [
    { label: 'Ready to buy', value: signalsSummary?.buyCount ?? 0 },
    { label: 'Ready to sell', value: signalsSummary?.sellCount ?? 0 },
  ]

  return (
    <Page>
      <PageHeader title="Portfolio" />
      <SummaryCard title="Holdings" stats={holdingsStats(portfolioHoldings.summary)} onClick={() => navigate('/portfolio/holdings')} />
      <SummaryCard title="Open Positions" stats={positionsStats(portfolioPositions.summary)} onClick={() => navigate('/portfolio/positions')} />
      <SummaryCard
        title="Recommendations"
        stats={recommendationStats}
        onClick={() => { setActiveTab('recommended'); navigate('/') }}
      />
    </Page>
  )
}

import { useState } from 'react'
import moment from 'moment'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFileLines, faSearch } from '@fortawesome/free-solid-svg-icons'
import Page from '../../components/Page'
import PageHeader from '../../components/PageHeader'
import Loader from '../../components/Loader'
import EmptyState from '../../components/EmptyState'
import ListItem from '../../components/ListItem'
import Badge from '../../components/Badge'
import { CardList } from '../../components/Card'
import { useApp } from '../../context/AppContext'
import FinancialsDetailSheet from './components/FinancialsDetailSheet'

const UPCOMING_DATE_FORMAT = 'DD-MMM-YYYY'
const ANNOUNCED_DATE_FORMAT = 'DD-MMM-YYYY HH:mm:ss'

const VERDICT_BADGES = {
  strong_positive: { label: 'Strong Positive', color: 'var(--color-success)' },
  positive: { label: 'Positive', color: 'var(--color-success)' },
  neutral: { label: 'Neutral', color: 'var(--color-text-muted)' },
  negative: { label: 'Negative', color: 'var(--color-danger)' },
}

export function VerdictBadge({ verdict }) {
  const config = VERDICT_BADGES[verdict] || { label: 'Pending', color: 'var(--color-text-tertiary)' }
  return <Badge label={config.label} color={config.color} />
}

export const FINANCIALS_SOURCE_LABELS = {
  bse: 'BSE',
  ocr: 'OCR',
  none: 'NONE',
}

export function PriceChangeBadge({ pct }) {
  if (pct === null || pct === undefined) return null
  const color = pct > 0 ? 'var(--color-success)' : pct < 0 ? 'var(--color-danger)' : 'var(--color-text-muted)'
  const sign = pct > 0 ? '+' : ''
  return <span style={{ ...styles.priceChangeText, color }}>{sign}{pct.toFixed(2)}%</span>
}

const DATE_FILTERS = [
  { key: 'today', label: 'Today', color: 'var(--color-primary)' },
  { key: 'yesterday', label: 'Yesterday', color: 'var(--color-primary)' },
]

const VERDICT_FILTERS = [
  { key: 'positive', label: 'Positive', color: 'var(--color-success)' },
  { key: 'strong_positive', label: 'Strong Positive', color: 'var(--color-success)' },
  { key: 'negative', label: 'Negative', color: 'var(--color-danger)' },
]

function filterPillStyle(color, active) {
  return {
    ...styles.filterPill,
    borderColor: color,
    color: active ? '#fff' : color,
    background: active ? color : 'transparent',
    fontWeight: active ? 600 : 500,
  }
}

export default function QuarterlyResults() {
  const { quarterlyResults } = useApp()
  const [tab, setTab] = useState('recent')
  const [searchQuery, setSearchQuery] = useState('')
  const [dateFilter, setDateFilter] = useState(null)
  const [verdictFilter, setVerdictFilter] = useState(null)
  const [selectedRecord, setSelectedRecord] = useState(null)

  if (!quarterlyResults) {
    return (
      <Page>
        <PageHeader title="Results" />
        <Loader />
      </Page>
    )
  }

  // The last-7-days window is enforced server-side (AppContext range-queries on announcedAtMs),
  // not here — "recent" in Firebase accumulates indefinitely so financials filled in later
  // survive future sync runs, but this component only ever receives the last 7 days over the wire.
  const recentList = Object.values(quarterlyResults.recent || {})
    .sort((a, b) => moment(b.announcedAt, ANNOUNCED_DATE_FORMAT).valueOf() - moment(a.announcedAt, ANNOUNCED_DATE_FORMAT).valueOf())

  const upcomingList = Object.entries(quarterlyResults.upcoming || {})
    .map(([symbol, item]) => ({ symbol, ...item }))
    .sort((a, b) => moment(a.date, UPCOMING_DATE_FORMAT).valueOf() - moment(b.date, UPCOMING_DATE_FORMAT).valueOf())

  const query = searchQuery.trim().toUpperCase()
  const matchesQuery = (symbol, name) => !query || symbol.toUpperCase().includes(query) || (name || '').toUpperCase().includes(query)

  const matchesDateFilter = (announcedAt) => {
    if (!dateFilter) return true
    const day = moment(announcedAt, ANNOUNCED_DATE_FORMAT)
    if (dateFilter === 'today') return day.isSame(moment(), 'day')
    return day.isSame(moment().subtract(1, 'day'), 'day')
  }

  const matchesVerdictFilter = (verdict) => !verdictFilter || verdict === verdictFilter

  const filteredRecent = recentList.filter(
    (item) => matchesQuery(item.symbol, item.companyName) && matchesDateFilter(item.announcedAt) && matchesVerdictFilter(item.financials?.overallVerdict)
  )
  const filteredUpcoming = upcomingList.filter((item) => matchesQuery(item.symbol, item.company))

  return (
    <Page>
      <PageHeader title="Results" />

      <div style={styles.tabs}>
        <button style={{ ...styles.tab, ...(tab === 'recent' ? styles.tabActive : {}) }} onClick={() => setTab('recent')}>
          Recent <Badge label={`${recentList.length}`} color={tab === 'recent' ? 'var(--color-primary)' : 'var(--color-text-muted)'} />
        </button>
        <button style={{ ...styles.tab, ...(tab === 'upcoming' ? styles.tabActive : {}) }} onClick={() => setTab('upcoming')}>
          Upcoming <Badge label={`${upcomingList.length}`} color={tab === 'upcoming' ? 'var(--color-primary)' : 'var(--color-text-muted)'} />
        </button>
      </div>

      <div style={styles.searchBar}>
        <FontAwesomeIcon icon={faSearch} style={styles.searchIcon} />
        <input
          style={styles.searchInput}
          placeholder="Search by symbol or company..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {tab === 'recent' && (
        <div style={styles.filterRow}>
          {DATE_FILTERS.map(({ key, label, color }) => (
            <button
              key={key}
              style={filterPillStyle(color, dateFilter === key)}
              onClick={() => setDateFilter(dateFilter === key ? null : key)}
            >
              {label}
            </button>
          ))}
          {VERDICT_FILTERS.map(({ key, label, color }) => (
            <button
              key={key}
              style={filterPillStyle(color, verdictFilter === key)}
              onClick={() => setVerdictFilter(verdictFilter === key ? null : key)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {tab === 'recent' && (
        filteredRecent.length === 0 ? (
          <EmptyState
            icon={faFileLines}
            title={recentList.length === 0 ? 'No recent results' : 'No matches'}
            subtitle={recentList.length === 0 ? 'Results announced in the last 7 days will show up here' : 'Try a different search or filter'}
          />
        ) : (
          <CardList style={styles.list}>
            {filteredRecent.map((item, i) => (
              <ListItem
                key={item.symbol}
                title={
                  <div style={styles.titleRow}>
                    <span>{item.symbol}</span>
                    <PriceChangeBadge pct={item.priceChangePct} />
                  </div>
                }
                subtitle={FINANCIALS_SOURCE_LABELS[item.financialsSource || 'none']}
                right={
                  <div style={styles.rightStack}>
                    <VerdictBadge verdict={item.financials?.overallVerdict} />
                    <span style={styles.dateText}>{moment(item.announcedAt, ANNOUNCED_DATE_FORMAT).format('DD MMM YYYY, h:mm A')}</span>
                  </div>
                }
                isLast={i === filteredRecent.length - 1}
                onClick={() => setSelectedRecord(item)}
              />
            ))}
          </CardList>
        )
      )}

      <FinancialsDetailSheet isOpen={!!selectedRecord} onClose={() => setSelectedRecord(null)} record={selectedRecord} />

      {tab === 'upcoming' && (
        filteredUpcoming.length === 0 ? (
          <EmptyState
            icon={faFileLines}
            title={upcomingList.length === 0 ? 'No upcoming results' : 'No matches'}
            subtitle={upcomingList.length === 0 ? 'Scheduled board meetings will show up here' : 'Try a different search'}
          />
        ) : (
          <CardList style={styles.list}>
            {filteredUpcoming.map((item, i) => (
              <ListItem
                key={item.symbol}
                title={item.symbol}
                right={moment(item.date, UPCOMING_DATE_FORMAT).format('DD MMM YYYY')}
                isLast={i === filteredUpcoming.length - 1}
              />
            ))}
          </CardList>
        )
      )}
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
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-xs)',
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
  filterRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-sm)',
    marginBottom: 'var(--space-md)',
  },
  filterPill: {
    padding: '5px 12px',
    borderRadius: '999px',
    border: '1px solid var(--color-text-muted)',
    background: 'transparent',
    fontSize: 'var(--font-caption)',
    fontWeight: 500,
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
  },
  searchBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
    marginBottom: 'var(--space-md)',
    padding: '10px 16px',
    borderRadius: 'var(--radius-md)',
    background: 'var(--color-card)',
  },
  searchIcon: {
    fontSize: '0.9rem',
    color: 'var(--color-text-muted)',
  },
  searchInput: {
    flex: 1,
    border: 'none',
    background: 'transparent',
    color: 'var(--color-text)',
    fontSize: 'var(--font-body)',
    outline: 'none',
  },
  list: {
    marginTop: 'var(--space-md)',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
  },
  priceChangeText: {
    fontSize: 'var(--font-footnote)',
    fontWeight: 600,
  },
  rightStack: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '4px',
  },
  dateText: {
    fontSize: 'var(--font-caption)',
    color: 'var(--color-text-muted)',
    whiteSpace: 'nowrap',
  },
}

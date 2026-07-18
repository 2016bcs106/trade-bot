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

const UPCOMING_DATE_FORMAT = 'DD-MMM-YYYY'
const ANNOUNCED_DATE_FORMAT = 'DD-MMM-YYYY HH:mm:ss'

const VERDICT_BADGES = {
  strong_positive: { label: 'Strong Positive', color: 'var(--color-success)' },
  positive: { label: 'Positive', color: 'var(--color-success)' },
  neutral: { label: 'Neutral', color: 'var(--color-text-muted)' },
  negative: { label: 'Negative', color: 'var(--color-danger)' },
}

function VerdictBadge({ verdict }) {
  const config = VERDICT_BADGES[verdict] || { label: 'Pending', color: 'var(--color-text-tertiary)' }
  return <Badge label={config.label} color={config.color} />
}

const DATE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
]

export default function QuarterlyResults() {
  const { quarterlyResults } = useApp()
  const [tab, setTab] = useState('recent')
  const [searchQuery, setSearchQuery] = useState('')
  const [dateFilter, setDateFilter] = useState('all')

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
  const recentList = Object.entries(quarterlyResults.recent || {})
    .map(([seqId, item]) => ({ seqId, ...item }))
    .sort((a, b) => moment(b.announcedAt, ANNOUNCED_DATE_FORMAT).valueOf() - moment(a.announcedAt, ANNOUNCED_DATE_FORMAT).valueOf())

  const upcomingList = Object.entries(quarterlyResults.upcoming || {})
    .map(([symbol, item]) => ({ symbol, ...item }))
    .sort((a, b) => moment(a.date, UPCOMING_DATE_FORMAT).valueOf() - moment(b.date, UPCOMING_DATE_FORMAT).valueOf())

  const query = searchQuery.trim().toUpperCase()
  const matchesQuery = (symbol, name) => !query || symbol.toUpperCase().includes(query) || (name || '').toUpperCase().includes(query)

  const matchesDateFilter = (announcedAt) => {
    if (dateFilter === 'all') return true
    const day = moment(announcedAt, ANNOUNCED_DATE_FORMAT)
    if (dateFilter === 'today') return day.isSame(moment(), 'day')
    return day.isSame(moment().subtract(1, 'day'), 'day')
  }

  const filteredRecent = recentList.filter((item) => matchesQuery(item.symbol, item.companyName) && matchesDateFilter(item.announcedAt))
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
          {DATE_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              style={{ ...styles.filterPill, ...(dateFilter === key ? styles.filterPillActive : {}) }}
              onClick={() => setDateFilter(key)}
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
                key={item.seqId}
                title={item.symbol}
                subtitle={moment(item.announcedAt, ANNOUNCED_DATE_FORMAT).format('DD MMM YYYY')}
                right={<VerdictBadge verdict={item.financials?.overallVerdict} />}
                isLast={i === filteredRecent.length - 1}
              />
            ))}
          </CardList>
        )
      )}

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
  filterPillActive: {
    background: 'var(--color-primary)',
    borderColor: 'var(--color-primary)',
    color: '#fff',
    fontWeight: 600,
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
}

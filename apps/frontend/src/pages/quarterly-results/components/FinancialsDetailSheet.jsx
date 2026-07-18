import { useState } from 'react'
import moment from 'moment'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCopy, faCircleCheck } from '@fortawesome/free-regular-svg-icons'
import { faArrowUpRightFromSquare } from '@fortawesome/free-solid-svg-icons'
import BottomSheet from '../../../components/BottomSheet'
import DetailRow from '../../../components/DetailRow'
import SectionHeader from '../../../components/SectionHeader'
import { VerdictBadge, FINANCIALS_SOURCE_LABELS, PriceChangeBadge } from '../QuarterlyResults'

const ZERODHA_CHART_ID = '6401'

const COPIED_FEEDBACK_MS = 1500

const ANNOUNCED_DATE_FORMAT = 'DD-MMM-YYYY HH:mm:ss'

const AUDIT_OPINION_LABELS = {
  unqualified: 'Unqualified',
  qualified: 'Qualified',
  adverse: 'Adverse',
  disclaimer: 'Disclaimer',
}

const SECTOR_METRIC_LABELS = {
  netInterestMarginPct: 'Net Interest Margin',
  grossNpaPct: 'Gross NPA',
  netNpaPct: 'Net NPA',
  provisionCoverageRatioPct: 'Provision Coverage Ratio',
  casaRatioPct: 'CASA Ratio',
  valueOfNewBusinessMarginPct: 'VNB Margin',
  persistencyRatioPct: 'Persistency Ratio',
  constantCurrencyRevenueGrowthPct: 'CC Revenue Growth',
  attritionRatePct: 'Attrition Rate',
  dealTcv: 'Deal TCV',
  sameStoreSalesGrowthPct: 'Same Store Sales Growth',
  volumeGrowthPct: 'Volume Growth',
  realizationPerUnit: 'Realization / Unit',
}

function crores(value) {
  if (value === null || value === undefined) return undefined
  return `${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr`
}

function pct(value) {
  if (value === null || value === undefined) return undefined
  return `${value.toFixed(2)}%`
}

function ratio(value) {
  if (value === null || value === undefined) return undefined
  return value.toFixed(2)
}

function days(value) {
  if (value === null || value === undefined) return undefined
  return `${value} days`
}

function bool(value) {
  if (value === null || value === undefined) return undefined
  return value ? 'Yes' : 'No'
}

function financialsSourceValue(source) {
  const resolved = source || 'none'
  const label = FINANCIALS_SOURCE_LABELS[resolved]
  const color = resolved === 'bse' ? 'var(--color-success)' : resolved === 'ocr' ? 'var(--color-text-muted)' : 'var(--color-text-tertiary)'
  return <span style={{ color }}>{label}</span>
}

function comparisonValue(comparison) {
  if (!comparison || comparison.pctChange === null || comparison.pctChange === undefined) return undefined
  const color = comparison.verdict === 'positive' ? 'var(--color-success)' : comparison.verdict === 'negative' ? 'var(--color-danger)' : 'var(--color-text-muted)'
  const sign = comparison.pctChange > 0 ? '+' : ''
  return <span style={{ color }}>{sign}{comparison.pctChange.toFixed(2)}%</span>
}

export default function FinancialsDetailSheet({ isOpen, onClose, record }) {
  const [copied, setCopied] = useState(false)

  if (!record) return null

  const f = record.financials || {}
  const zerodhaUrl = `https://kite.zerodha.com/markets/chart/web/ciq/NSE/${record.symbol}/${ZERODHA_CHART_ID}`
  const paytmUrl = record.pmlId ? `https://www.paytmmoney.com/stocks/company/${record.pmlId}` : null
  const sectorMetricEntries = Object.entries(f.sectorMetrics || {}).filter(([, value]) => value !== null && value !== undefined)
  const has = (value) => value !== null && value !== undefined
  const hasComparison = (comparison) => has(comparison?.pctChange)

  const hasProfitLoss = has(f.revenue) || has(f.profitBeforeTax) || has(f.netProfit) || has(f.operatingMarginPct) || has(f.eps) || has(f.exceptionalItems)
  const hasYoy = hasComparison(f.yoy?.revenue) || hasComparison(f.yoy?.netProfit) || hasComparison(f.yoy?.operatingMargin)
  const hasQoq = hasComparison(f.qoq?.revenue) || hasComparison(f.qoq?.netProfit) || hasComparison(f.qoq?.operatingMargin)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(record.symbol)
      setCopied(true)
      setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
    } catch (err) {
      console.error('Failed to copy symbol to clipboard', err)
    }
  }

  return (
    <BottomSheet
      title={
        <span style={styles.titleRow}>
          <span style={styles.companyName}>{record.companyName}</span>
          <span style={styles.titleRight}>
            <span style={styles.symbol}>{record.symbol}</span>
            <FontAwesomeIcon icon={copied ? faCircleCheck : faCopy} onClick={handleCopy} style={styles.copyIcon} />
          </span>
        </span>
      }
      isOpen={isOpen}
      onClose={onClose}
      footer={
        <>
          <div style={styles.brokerLinks}>
            <a href={zerodhaUrl} target="_blank" rel="noopener noreferrer" style={styles.brokerLink}>
              Zerodha
              <FontAwesomeIcon icon={faArrowUpRightFromSquare} style={styles.brokerLinkIcon} />
            </a>
            {paytmUrl && (
              <a href={paytmUrl} target="_blank" rel="noopener noreferrer" style={styles.brokerLink}>
                Paytm
                <FontAwesomeIcon icon={faArrowUpRightFromSquare} style={styles.brokerLinkIcon} />
              </a>
            )}
          </div>
          <button style={styles.closeButton} onClick={onClose}>Close</button>
        </>
      }
    >
      <SectionHeader style={styles.firstSection}>Overview</SectionHeader>
      <div style={styles.body}>
        <DetailRow label="Verdict" value={<VerdictBadge verdict={f.overallVerdict} />} />
        <DetailRow label="Announced" value={moment(record.announcedAt, ANNOUNCED_DATE_FORMAT).format('DD MMM YYYY, h:mm A')} />
        <DetailRow label="Audit Opinion" value={AUDIT_OPINION_LABELS[f.auditOpinion]} />
        <DetailRow label="Data Source" value={financialsSourceValue(record.financialsSource)} />
        {has(record.releasePrice) && (
          <DetailRow label="Price at Release" value={`₹${record.releasePrice.toFixed(2)}`} />
        )}
        {has(record.latestPrice) && (
          <DetailRow
            label="Latest Price"
            value={
              <span style={styles.priceRow}>
                {`₹${record.latestPrice.toFixed(2)}`}
                <PriceChangeBadge pct={record.priceChangePct} />
              </span>
            }
          />
        )}
      </div>

      {hasProfitLoss && (
        <>
          <SectionHeader>Profit &amp; Loss</SectionHeader>
          <div style={styles.body}>
            <DetailRow label="Revenue" value={crores(f.revenue)} />
            <DetailRow label="Profit Before Tax" value={crores(f.profitBeforeTax)} />
            <DetailRow label="Net Profit" value={crores(f.netProfit)} />
            <DetailRow label="Operating Margin" value={pct(f.operatingMarginPct)} />
            <DetailRow label="EPS" value={has(f.eps) ? `₹${f.eps.toFixed(2)}` : undefined} />
            <DetailRow label="Exceptional Items" value={crores(f.exceptionalItems)} />
          </div>
        </>
      )}

      {hasYoy && (
        <>
          <SectionHeader>Year-on-Year</SectionHeader>
          <div style={styles.body}>
            <DetailRow label="Revenue" value={comparisonValue(f.yoy?.revenue)} />
            <DetailRow label="Net Profit" value={comparisonValue(f.yoy?.netProfit)} />
            <DetailRow label="Operating Margin" value={comparisonValue(f.yoy?.operatingMargin)} />
          </div>
        </>
      )}

      {hasQoq && (
        <>
          <SectionHeader>Quarter-on-Quarter</SectionHeader>
          <div style={styles.body}>
            <DetailRow label="Revenue" value={comparisonValue(f.qoq?.revenue)} />
            <DetailRow label="Net Profit" value={comparisonValue(f.qoq?.netProfit)} />
            <DetailRow label="Operating Margin" value={comparisonValue(f.qoq?.operatingMargin)} />
          </div>
        </>
      )}

      {(f.debtToEquityRatio !== null && f.debtToEquityRatio !== undefined ||
        f.interestCoverageRatio !== null && f.interestCoverageRatio !== undefined ||
        f.receivableDays !== null && f.receivableDays !== undefined ||
        f.inventoryDays !== null && f.inventoryDays !== undefined ||
        f.returnOnEquityPct !== null && f.returnOnEquityPct !== undefined ||
        f.returnOnCapitalEmployedPct !== null && f.returnOnCapitalEmployedPct !== undefined) && (
        <>
          <SectionHeader>Balance Sheet &amp; Returns</SectionHeader>
          <div style={styles.body}>
            <DetailRow label="Debt to Equity" value={ratio(f.debtToEquityRatio)} />
            <DetailRow label="Interest Coverage" value={ratio(f.interestCoverageRatio)} />
            <DetailRow label="Receivable Days" value={days(f.receivableDays)} />
            <DetailRow label="Inventory Days" value={days(f.inventoryDays)} />
            <DetailRow label="Return on Equity" value={pct(f.returnOnEquityPct)} />
            <DetailRow label="Return on Capital Employed" value={pct(f.returnOnCapitalEmployedPct)} />
          </div>
        </>
      )}

      {(f.operatingCashFlow !== null && f.operatingCashFlow !== undefined || f.freeCashFlow !== null && f.freeCashFlow !== undefined) && (
        <>
          <SectionHeader>Cash Flow</SectionHeader>
          <div style={styles.body}>
            <DetailRow label="Operating Cash Flow" value={crores(f.operatingCashFlow)} />
            <DetailRow label="Free Cash Flow" value={crores(f.freeCashFlow)} />
          </div>
        </>
      )}

      {sectorMetricEntries.length > 0 && (
        <>
          <SectionHeader>Sector Metrics</SectionHeader>
          <div style={styles.body}>
            {sectorMetricEntries.map(([key, value]) => (
              <DetailRow key={key} label={SECTOR_METRIC_LABELS[key] || key} value={key.endsWith('Pct') ? pct(value) : crores(value)} />
            ))}
          </div>
        </>
      )}

      {(f.auditQualificationNotes || f.relatedPartyTransactionsFlag !== null && f.relatedPartyTransactionsFlag !== undefined ||
        f.forwardGuidance || f.orderBookValue !== null && f.orderBookValue !== undefined || f.majorDealWins) && (
        <>
          <SectionHeader>Disclosures</SectionHeader>
          <div style={styles.body}>
            <DetailRow label="Audit Qualification" value={f.auditQualificationNotes} />
            <DetailRow label="Related Party Transactions" value={bool(f.relatedPartyTransactionsFlag)} />
            <DetailRow label="Forward Guidance" value={f.forwardGuidance} />
            <DetailRow label="Order Book" value={crores(f.orderBookValue)} />
            <DetailRow label="Major Deal Wins" value={f.majorDealWins} />
          </div>
        </>
      )}

      {(f.revenueEstimateBeat !== null && f.revenueEstimateBeat !== undefined || f.profitEstimateBeat !== null && f.profitEstimateBeat !== undefined) && (
        <>
          <SectionHeader>vs. Estimates</SectionHeader>
          <div style={{ ...styles.body, ...styles.lastSection }}>
            <DetailRow label="Revenue Beat" value={bool(f.revenueEstimateBeat)} />
            <DetailRow label="Profit Beat" value={bool(f.profitEstimateBeat)} />
          </div>
        </>
      )}
    </BottomSheet>
  )
}

const styles = {
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-sm)',
    width: '100%',
    textAlign: 'left',
  },
  titleRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
    flexShrink: 0,
  },
  symbol: {
    fontSize: 'var(--font-title3)',
    fontWeight: 700,
    color: 'var(--color-text)',
  },
  companyName: {
    fontSize: 'var(--font-body)',
    fontWeight: 400,
    color: 'var(--color-text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
    marginRight: 'var(--space-md)',
  },
  copyIcon: {
    fontSize: '0.85rem',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
  },
  priceRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
  },
  firstSection: {
    marginTop: 0,
  },
  body: {
    padding: '0 var(--space-lg)',
  },
  lastSection: {
    paddingBottom: 'var(--space-xl)',
  },
  brokerLinks: {
    display: 'flex',
    gap: 'var(--space-sm)',
    marginBottom: 'var(--space-sm)',
  },
  brokerLink: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-xs)',
    padding: '10px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--color-border)',
    fontSize: 'var(--font-footnote)',
    fontWeight: 600,
    color: 'var(--color-primary)',
    textDecoration: 'none',
  },
  brokerLinkIcon: {
    fontSize: '0.7rem',
  },
  closeButton: {
    width: '100%',
    padding: '12px',
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    background: 'var(--color-primary)',
    color: '#fff',
    fontSize: 'var(--font-body)',
    fontWeight: 600,
    cursor: 'pointer',
  },
}

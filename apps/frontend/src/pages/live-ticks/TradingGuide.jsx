import BottomSheet from '../../components/BottomSheet'

export default function TradingGuide({ isOpen, onClose }) {
  return (
    <BottomSheet title="Trading Guide" isOpen={isOpen} onClose={onClose}>
      <div style={styles.content}>
        <div style={styles.section}>
          <div style={styles.title}>When to BUY (Go Long)</div>
          <div style={styles.item}>Price drops to the lower Bollinger Band AND RSI is below 30 — buyers stepping in, bounce likely</div>
          <div style={styles.item}>Bands get very narrow (squeeze), then price pops upward AND RSI is above 50 — new uptrend starting</div>
        </div>
        <div style={styles.section}>
          <div style={styles.title}>When to SELL (Go Short)</div>
          <div style={styles.item}>Price rises to the upper Bollinger Band AND RSI is above 70 — sellers stepping in, drop likely</div>
          <div style={styles.item}>Bands get very narrow (squeeze), then price drops AND RSI is below 50 — new downtrend starting</div>
        </div>
        <div style={styles.section}>
          <div style={styles.title}>When to EXIT</div>
          <div style={styles.item}>Long position: exit when price reaches the middle band (SMA). Stop loss if price falls below the lower band.</div>
          <div style={styles.item}>Short position: exit when price reaches the middle band. Stop loss if price rises above the upper band.</div>
        </div>
        <div style={styles.section}>
          <div style={styles.title}>When to do NOTHING</div>
          <div style={styles.item}>Price is in the middle of the bands, RSI is between 40-60 — no clear direction, wait for a setup</div>
        </div>
        <div style={styles.section}>
          <div style={styles.title}>High Conviction: Squeeze Breakout</div>
          <div style={styles.item}>1. Bands become very tight (low volatility)</div>
          <div style={styles.item}>2. Price moves sharply in one direction</div>
          <div style={styles.item}>3. RSI confirms (above 50 for up, below 50 for down)</div>
          <div style={styles.item}>4. B/S ratio confirms (above 1 for up, below 1 for down)</div>
        </div>
      </div>
    </BottomSheet>
  )
}

const styles = {
  content: {
    padding: '8px var(--space-xl) 24px',
  },
  section: {
    marginBottom: '20px',
  },
  title: {
    fontSize: 'var(--font-subhead)',
    fontWeight: 700,
    color: 'var(--color-text)',
    marginBottom: '8px',
  },
  item: {
    fontSize: 'var(--font-footnote)',
    color: 'var(--color-text-muted)',
    lineHeight: 1.5,
    paddingLeft: '12px',
    borderLeft: '2px solid var(--color-border)',
    marginBottom: '6px',
  },
}

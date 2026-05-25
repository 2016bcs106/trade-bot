# ML Prediction Enhancement Plan

## Overview

Current system predicts daily **High** and **Low** values using the first 45 minutes of 1-min OHLCV data. This plan extends it with:

1. **Close price prediction** — predict the 3:30 PM closing price
2. **Time-of-event prediction** — predict *when* high/low will be reached
3. **Realtime rolling forecast** — update predictions continuously as the day progresses

---

## Phase 1: Predict Close Value

**Goal**: Add `predictedClose` to the daily prediction output.

### Step 1.1 — Extend the Model

- [ ] Add `predictClose(features: number[]): number` method to `TrainableModel` interface
- [ ] Implement in `LinearRegressionModel` — train a third set of weights for close
- [ ] Update `ModelTrainer` to fit the close regression alongside high/low
- [ ] Training target: `actualClose` from historical data (already in `Prediction` type)

### Step 1.2 — Update Prediction Engine

- [ ] In `prediction-engine.ts`, call `model.predictClose(featureArray)` 
- [ ] Add `predictedClose` field to the `Prediction` interface
- [ ] Store it alongside `predictedHigh` and `predictedLow` in Firebase

### Step 1.3 — Update Evaluation

- [ ] In `evaluation-engine.ts`, compute close error: `|predictedClose - actualClose|`
- [ ] Add `closeError` and `closeMAPE` to `EvaluationResult`
- [ ] Update aggregate metrics

### Step 1.4 — Frontend

- [ ] Show predicted close in the direction badge (Home page)
- [ ] Add a third horizontal dotted line (blue) for predicted close on the chart
- [ ] Update Dashboard/Audit pages if they show prediction details

### Estimated Effort: 2-3 hours

---

## Phase 2: Time-of-Event Prediction (When will High/Low occur?)

**Goal**: Predict the time bucket when the daily high and low will be reached.

### Approach: Time Bucket Classification

Divide the trading day (9:15-15:30 = 375 minutes) into 6 buckets:

| Bucket | Time Range | Label |
|--------|-----------|-------|
| 1 | 09:15 - 10:15 | "Early Morning" |
| 2 | 10:15 - 11:15 | "Late Morning" |
| 3 | 11:15 - 12:15 | "Midday" |
| 4 | 12:15 - 13:15 | "Early Afternoon" |
| 5 | 13:15 - 14:15 | "Late Afternoon" |
| 6 | 14:15 - 15:30 | "Close" |

### Step 2.1 — Training Data Preparation

- [ ] For each historical day, find the minute when high was reached → map to bucket
- [ ] Same for low
- [ ] Store as labels: `highBucket: 1-6`, `lowBucket: 1-6`

### Step 2.2 — Classification Model

- [ ] Create `TimeBucketClassifier` — a simple softmax/logistic regression over 6 classes
- [ ] Input: same feature vector as high/low model
- [ ] Output: probability distribution over 6 buckets + predicted bucket
- [ ] Train separately from price model (or as additional heads)

### Step 2.3 — Integration

- [ ] Add `predictedHighBucket`, `predictedLowBucket` to `Prediction` type
- [ ] Add `highBucketConfidence`, `lowBucketConfidence` (probability of predicted bucket)
- [ ] Update prediction engine to call the classifier

### Step 2.4 — Evaluation

- [ ] Compute "bucket accuracy": % of days where predicted bucket matches actual
- [ ] Compute "±1 bucket accuracy": % where prediction is within 1 bucket of actual
- [ ] Track in evaluation results

### Step 2.5 — Frontend

- [ ] Show time range below the prediction badge: "High expected 11:15-12:15"
- [ ] Color-code by confidence (green = high confidence, yellow = uncertain)

### Estimated Effort: 4-6 hours

---

## Phase 3: Realtime Rolling Forecast

**Goal**: As new candles arrive during the day, continuously update predictions.

### Architecture

```
9:15  → Initial prediction (based on opening candle + previous day context)
9:20  → Update 1 (5 min of data)
9:25  → Update 2 (10 min of data)
9:30  → Update 3 (15 min of data)
...
10:00 → Update 9 (45 min of data) ← current model's sweet spot
...every 5 min until 15:25
15:25 → Final prediction (370 min of data)
```

**Update frequency: every 5 minutes** (~75 updates per stock per day)

### Step 3.1 — Multi-Horizon Feature Engineering

- [ ] Modify `FeatureEngineer` to accept variable-length candle arrays
- [ ] Add `minutesElapsed` as an input feature (so model knows how much data it has)
- [ ] Normalize features relative to the amount of data available
- [ ] Key features by horizon: opening gap, VWAP so far, range so far, volume profile

### Step 3.2 — Train Horizon-Aware Model

**Option A: Single Model with Time Feature** (recommended to start)
- [ ] Include `minutesElapsed / 375` as a normalized feature (0.0 = open, 1.0 = close)
- [ ] Train on samples from ALL time horizons (not just minute-45)
- [ ] For each historical day, create training samples at minutes: 15, 30, 45, 60, 75, 90, 105, 120, ...
- [ ] Each sample has the same targets (daily H/L/C) but different feature sets

**Option B: Separate Models per Horizon** (more accurate, more complex)
- [ ] Train `model-30min`, `model-60min`, `model-90min`, etc.
- [ ] Each model specializes in predicting from a specific amount of intraday data
- [ ] At runtime, select the model that matches elapsed time

### Step 3.3 — Realtime Prediction Loop

- [ ] In `trade-bot.ts`, every **5 minutes** during market hours:
  1. Fetch all candles so far today via `fetchOHLCV(pmlId, today, today)`
  2. Compute features from available candles
  3. Run prediction model
  4. Update Firebase `predictions/{symbol}/{date}` with new values
  5. Overwrite `predictedHigh`, `predictedLow`, `predictedClose`
  6. Store prediction history at `predictions/{symbol}/{date}/history/{time}`

### Step 3.4 — Confidence Decay/Growth

- [ ] Early predictions (9:15) should have lower confidence
- [ ] As more data arrives and predictions stabilize, confidence increases
- [ ] If predicted H/L already breached by actuals, adjust prediction upward/downward
- [ ] Logic: `if (currentHigh > predictedHigh) predictedHigh = currentHigh * 1.01`

### Step 3.5 — Frontend Live Updates

- [ ] Prediction lines on chart update in realtime (Firebase `onValue` already handles this)
- [ ] Show "last updated: 11:00" timestamp on the prediction badge
- [ ] Show prediction history as a fading trail (optional — nice to have)
- [ ] Add confidence indicator that grows through the day

### Step 3.6 — Evaluation Enhancement

- [ ] Track prediction accuracy at each time horizon
- [ ] Build a "convergence chart": how quickly does the prediction converge to actual?
- [ ] Store per-horizon metrics: MAE@30min, MAE@60min, MAE@90min, etc.

### Estimated Effort: 8-12 hours

---

## Implementation Priority

```
Phase 1 (Close prediction)     → DO FIRST  (easy win, 2-3h)
Phase 3 (Realtime forecast)    → DO SECOND (high value, 8-12h)
Phase 2 (Time-of-event)        → DO THIRD  (nice to have, 4-6h)
```

---

## Technical Notes

### Current Architecture (for reference)

```
Feature Vector (from first 45 min):
├── openingGap (vs prev close)
├── firstCandleRange
├── volumeSpike (first 15 min vs prev day avg)
├── vwap
├── rangeFirst30
├── momentumSlope
├── prevDayClose, prevDayHigh
└── ... (see feature-engineer.ts)

Model: LinearRegressionModel
├── predictHigh(features) → number
├── predictLow(features) → number
└── [NEW] predictClose(features) → number

Prediction stored at: predictions/{symbol}/{YYYY-MM-DD}
Evaluation stored at: evaluations/{symbol}/{YYYY-MM-DD}
```

### Data Flow

```
fetchOHLCV(pmlId, date, date) → OHLCV[]
  → FeatureEngineer.compute() → FeatureVector
    → model.predictHigh/Low/Close() → Prediction
      → Firebase: predictions/{symbol}/{date}
        → Frontend: realtime chart overlay
```

### Key Files to Modify

| File | Phase |
|------|-------|
| `training/models/trainable-model.ts` | 1 |
| `training/models/linear-regression-model.ts` | 1 |
| `training/model-trainer.ts` | 1, 2, 3 |
| `features/feature-engineer.ts` | 3 |
| `prediction/prediction-engine.ts` | 1, 2, 3 |
| `evaluation/evaluation-engine.ts` | 1, 2 |
| `types/predictions/prediction.ts` | 1, 2 |
| `types/predictions/evaluation-result.ts` | 1, 2 |
| `cli/trade-bot.ts` | 3 |
| `frontend/src/pages/Home.jsx` | 1, 3 |
| `frontend/src/components/PortfolioChart.jsx` | 1, 3 |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Close prediction MAPE | < 1.5% |
| High/Low time bucket accuracy | > 40% (vs 16.7% random) |
| ±1 bucket accuracy | > 65% |
| Realtime forecast MAE improvement by 14:00 vs 10:00 | > 30% reduction |
| Prediction convergence by 13:00 | Within 0.5% of actual |

---

## Decisions

1. **Model architecture for Close**: Start with linear regression (same as H/L). Upgrade to polynomial features or trees only if MAPE > 2%.
2. **Realtime forecast frequency**: Every **5 minutes** — aggressive updates for maximum freshness.
3. **Time-of-event visualization**: Yes — show as a **shaded region** on the chart in the predicted time bucket.
4. **Prediction flip tracking**: No — not needed as audit entry.

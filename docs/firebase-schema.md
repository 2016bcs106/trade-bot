# Firebase Realtime Database Schema

This document describes the complete RTDB schema for the trade-bot prediction platform.

## Overview

```
root/
├── auth/                          # Authentication tokens
├── config/                        # Runtime configuration
├── scripts/                       # Running script statuses
├── prices/                        # Live tick data
├── signals/                       # Trade signals
├── stocks/                        # Stock tracking configuration
├── predictions/                   # Daily predictions & evaluations
├── models/                        # ML model metadata
└── audit/                         # System audit trail
```

---

## `auth/`

```
auth/
├── accessToken/         { token: string, timestamp: number }
├── publicAccessToken/   { token: string, timestamp: number }
├── readAccessToken/     { token: string, timestamp: number }
├── requestToken/        { token: string, timestamp: number }
└── updatedOn            number (epoch ms)
```

## `config/`

```
config/
└── enabled              boolean
```

## `scripts/{SCRIPT_NAME}/`

```
scripts/trade-bot/
├── status               "running" | "stopped" | "errored"
├── lastHeartbeat        number (epoch ms)
├── startedAt            number (epoch ms)
├── error                string | null
└── metadata             { ... }
```

## `prices/` and `signals/`

Push-key lists of `TickData` and `SignalData` objects.

---

## `stocks/{SYMBOL}/`

Tracks which stocks are being monitored for prediction. Each stock is keyed by its uppercase ticker symbol.

```
stocks/RELIANCE/
├── symbol                  "RELIANCE"
├── name                    "Reliance Industries Ltd"
├── securityId              "1234"               # Paytm Money security ID
├── exchange                "NSE" | "BSE"
├── enabled                 true                 # Active prediction generation
├── autoOptimize            true                 # Allow auto model promotion
├── currentProductionVersion "v3" | null         # Active model version
├── addedAt                 1716500000000        # When stock was added (epoch ms)
└── updatedAt               1716500000000        # Last config change (epoch ms)
```

**TypeScript:** `StockConfig` (`src/types/stocks/stock-config.ts`)

**Access patterns:**
- Frontend: List all stocks, toggle enabled/autoOptimize
- Worker: Watch for new stocks, read enabled stocks for daily pipeline
- Query: `stocks/` ordered by `enabled` = true

---

## `predictions/{SYMBOL}/{YYYY-MM-DD}/`

Stores daily predictions. Each prediction is keyed by symbol and date for O(1) lookup.

```
predictions/RELIANCE/2025-05-24/
├── symbol              "RELIANCE"
├── date                "2025-05-24"
├── predictedHigh       2850.50
├── predictedLow        2790.25
├── modelVersion        "v3"
├── modelType           "random-forest"
├── confidence          0.82 | null
├── generatedAt         1716500000000        # Epoch ms
├── actualHigh          2845.00 | null       # Filled after market close
├── actualLow           2795.50 | null       # Filled after market close
├── evaluated           true | false
└── evaluation/                              # Nested evaluation result
    ├── symbol              "RELIANCE"
    ├── date                "2025-05-24"
    ├── modelVersion        "v3"
    ├── highError           5.50
    ├── lowError            5.25
    ├── mae                 5.375
    ├── rmse               5.38
    ├── mape               0.19
    ├── directionalAccuracy true
    ├── rangeContainment    true
    └── evaluatedAt         1716550000000
```

**TypeScript:** `Prediction` (`src/types/predictions/prediction.ts`), `EvaluationResult` (`src/types/predictions/evaluation-result.ts`)

**Access patterns:**
- Worker: Write prediction before market, update actual values after close
- Frontend: Read last N days of predictions for a stock
- Query: `predictions/SYMBOL/` ordered by date (lexicographic)

---

## `models/{SYMBOL}/{VERSION}/`

Stores metadata about trained ML models. Actual model weights are stored as files in `models/` directory on disk.

```
models/RELIANCE/v3/
├── symbol              "RELIANCE"
├── version             "v3"
├── modelType           "random-forest"
├── state               "production"         # training | shadow | production | retired | failed
├── training/
│   ├── dataStartDate   "2024-01-01"
│   ├── dataEndDate     "2025-05-20"
│   ├── sampleCount     350
│   ├── featureCount    28
│   ├── features        ["cumReturn", "openGap", "atr14", ...]
│   ├── hyperparameters { nEstimators: 100, maxDepth: 10, ... }
│   └── durationMs      45000
├── metrics/
│   ├── mae             4.2
│   ├── rmse            5.1
│   ├── mape            0.15
│   ├── directionalAccuracy 72.5
│   ├── rangeContainment    68.0
│   ├── r2              0.78
│   └── validationSamples   50
├── trainedAt           1716400000000
├── promotedAt          1716450000000 | null
├── retiredAt           null
└── modelPath           "models/RELIANCE/v3.json"
```

**TypeScript:** `ModelMetadata`, `ModelState`, `TrainingInfo`, `ModelMetrics` (`src/types/models/model-metadata.ts`)

**Access patterns:**
- Worker: Create on training complete, update state on promotion/retirement
- Frontend: List all versions for a stock, show production vs shadow
- Query: `models/SYMBOL/` to list all versions, filter by `state`

**Model lifecycle:**
```
training → shadow → production → retired
             ↓
           failed
```

---

## `audit/{EVENT_ID}/`

Chronological log of all system events. Uses Firebase push keys (time-sorted) for natural ordering.

```
audit/-NxAbCdEfGh/
├── id                  "-NxAbCdEfGh"          # Firebase push key
├── type                "model.promoted"        # Event type enum
├── symbol              "RELIANCE" | null       # null for system events
├── description         "Model v3 promoted to production for RELIANCE"
├── timestamp           1716500000000
└── metadata            { fromVersion: "v2", toVersion: "v3", reason: "auto" }
```

**TypeScript:** `AuditEvent`, `AuditEventType` (`src/types/audit/audit-event.ts`)

**Event types:**

| Category | Events |
|----------|--------|
| Stock | `stock.added`, `stock.removed`, `stock.enabled`, `stock.disabled`, `stock.config_updated` |
| Training | `training.started`, `training.completed`, `training.failed` |
| Model | `model.promoted`, `model.retired`, `model.rollback`, `model.auto_promoted` |
| Prediction | `prediction.generated`, `prediction.failed` |
| Evaluation | `evaluation.completed`, `evaluation.failed` |
| System | `scheduler.started`, `scheduler.stopped`, `system.error` |

**Access patterns:**
- Worker: Push new events on every significant action
- Frontend: List recent events, filter by type/symbol
- Query: `audit/` ordered by key (time-based) with `limitToLast(N)`

---

## Data Size Considerations

| Path | Growth Rate | Cleanup Strategy |
|------|-------------|------------------|
| `stocks/` | Low (manual adds) | No cleanup needed |
| `predictions/` | ~1 record/stock/day | Archive after 6 months |
| `models/` | ~1-2 records/stock/week | Keep all (small metadata) |
| `audit/` | ~10-50 events/day | Archive after 3 months |

---

## Security Rules

```json
{
  "rules": {
    "stocks": { ".read": true, ".write": true },
    "predictions": { ".read": true, ".write": true },
    "models": { ".read": true, ".write": true },
    "audit": { ".read": true, ".write": true }
  }
}
```

> Note: Single-user system with no REST API exposure — rules are permissive.
> The worker authenticates via direct DB URL access.

---

## Usage Examples

### Adding a stock (Worker)
```typescript
await firebaseClient.setStock("RELIANCE", {
  symbol: "RELIANCE",
  name: "Reliance Industries Ltd",
  securityId: "1234",
  exchange: "NSE",
  enabled: true,
  autoOptimize: true,
  currentProductionVersion: null,
  addedAt: Date.now(),
  updatedAt: Date.now(),
});
```

### Storing a prediction (Worker)
```typescript
await firebaseClient.setPrediction("RELIANCE", "2025-05-24", {
  symbol: "RELIANCE",
  date: "2025-05-24",
  predictedHigh: 2850.50,
  predictedLow: 2790.25,
  modelVersion: "v3",
  modelType: "random-forest",
  confidence: 0.82,
  generatedAt: Date.now(),
  actualHigh: null,
  actualLow: null,
  evaluated: false,
});
```

### Logging an audit event (Worker)
```typescript
await firebaseClient.pushAuditEvent({
  id: "", // will be overwritten by push key
  type: "model.promoted",
  symbol: "RELIANCE",
  description: "Model v3 promoted to production for RELIANCE",
  timestamp: Date.now(),
  metadata: { fromVersion: "v2", toVersion: "v3", reason: "auto" },
});
```

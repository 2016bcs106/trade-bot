/**
 * Model metadata stored at `models/SYMBOL/VERSION/`
 * Tracks training configuration, performance metrics, and lifecycle state.
 */
export interface ModelMetadata {
  /** Stock symbol this model is trained for */
  symbol: string;

  /** Version identifier (e.g., "v1", "v2") */
  version: string;

  /** Algorithm type */
  modelType: string;

  /** Current lifecycle state */
  state: ModelState;

  /** Training configuration and hyperparameters */
  training: TrainingInfo;

  /** Promotion metrics — weighted percentile across all horizon models */
  promotionMetrics: PromotionMetrics;

  /** IST timestamp when model was created (YYYY-MM-DD HH:mm:ss) */
  createdAt: string;

  /** IST timestamp when model was promoted to production (null if never promoted) */
  promotedAt: string | null;

  /** IST timestamp when model was retired (null if still active) */
  retiredAt: string | null;
}

/** Model lifecycle states */
export type ModelState = "training" | "shadow" | "production" | "retired" | "failed";

/** Training configuration details */
export interface TrainingInfo {
  /** Start date of training data window (YYYY-MM-DD) */
  dataStartDate: string;

  /** End date of training data window (YYYY-MM-DD) */
  dataEndDate: string;

  /** Number of training samples used */
  sampleCount: number;

  /** Number of features used */
  featureCount: number;

  /** Feature names used for training */
  features: string[];

  /** Hyperparameters (model-type specific) */
  hyperparameters: Record<string, unknown>;

  /** Training duration in milliseconds */
  durationMs: number;

  /** Window size (number of 1-min candles from market open) used for feature computation */
  windowSize: number;
}

/** Model performance metrics from validation */
export interface ModelMetrics {
  /** Mean Absolute Error on validation set */
  mae: number;

  /** Root Mean Square Error on validation set */
  rmse: number;

  /** Mean Absolute Percentage Error (%) on validation set */
  mape: number;

  /** Directional accuracy (%) on validation set */
  directionalAccuracy: number;

  /** Range containment (%) on validation set */
  rangeContainment: number;

  /** R-squared score */
  r2: number;

  /** Number of validation samples */
  validationSamples: number;
}

/**
 * Promotion metrics — used to decide whether a new version should replace the current production model.
 * Uses weighted percentile-based scoring that favors early horizons (intraday trading focus).
 */
export interface PromotionMetrics {
  /** Weighted P75 MAE — primary promotion criterion (lower = better) */
  weightedP75MAE: number;

  /** Average MAE across all horizons (informational) */
  avgMAE: number;

  /** Maximum MAPE in first hour (horizons 5-60 min) — hard floor check */
  maxMAPE_firstHour: number;

  /** Average directional accuracy in first hour (horizons 5-60 min) */
  directionalAccuracy_firstHour: number;

  /** Number of horizon models trained successfully */
  horizonCount: number;

  /** Per-horizon breakdown for debugging and analysis */
  perHorizon: HorizonMetricEntry[];
}

/** Per-horizon metric entry */
export interface HorizonMetricEntry {
  /** Horizon in minutes (5, 10, 15, ..., 375) */
  horizon: number;

  /** MAE for this horizon */
  mae: number;

  /** MAPE for this horizon */
  mape: number;

  /** Directional accuracy for this horizon */
  directionalAccuracy: number;

  /** Exponential weight applied (higher for early horizons) */
  weight: number;
}

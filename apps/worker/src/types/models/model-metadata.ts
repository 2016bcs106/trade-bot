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
  modelType: "linear-regression" | "random-forest";

  /** Current lifecycle state */
  state: ModelState;

  /** Training configuration and hyperparameters */
  training: TrainingInfo;

  /** Performance metrics from walk-forward validation */
  metrics: ModelMetrics;

  /** ISO timestamp when training started */
  trainedAt: number;

  /** ISO timestamp when model was promoted to production (null if never promoted) */
  promotedAt: number | null;

  /** ISO timestamp when model was retired (null if still active) */
  retiredAt: number | null;

  /** Relative path to serialized model file (e.g., "models/RELIANCE/v3.json") */
  modelPath: string;
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

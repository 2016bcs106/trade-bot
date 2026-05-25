import { ModelMetrics, TrainingInfo } from "../../types/models/model-metadata.ts";

/**
 * Interface for all trainable ML models.
 * Each model must predict HIGH, LOW, and CLOSE targets.
 */
export interface TrainableModel {
  /** Fit the model on training data */
  fit(X: number[][], yHigh: number[], yLow: number[], yClose: number[]): void;

  /** Predict the daily high from feature vector */
  predictHigh(x: number[]): number;

  /** Predict the daily low from feature vector */
  predictLow(x: number[]): number;

  /** Predict the daily close from feature vector */
  predictClose(x: number[]): number;

  /** Serialize model weights to JSON string for persistence */
  serialize(): string;

  /** Get hyperparameters used for training info */
  getHyperparameters(): Record<string, unknown>;
}

export type ModelType = "linear-regression";

/**
 * Result of a successful model training.
 */
export interface TrainingResult {
  modelType: ModelType;
  symbol: string;
  serializedModel: string;
  training: TrainingInfo;
  metrics: ModelMetrics;
}

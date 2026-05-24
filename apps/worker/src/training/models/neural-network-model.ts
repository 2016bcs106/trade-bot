import * as tf from "@tensorflow/tfjs";
import { TrainableModel } from "./trainable-model.ts";

// Suppress TF.js logs
tf.env().set("PROD", true);

/**
 * Feedforward Neural Network for regression using TensorFlow.js.
 * Architecture: Input → Dense(64,relu) → Dropout → Dense(32,relu) → Dropout → Dense(2, linear)
 *
 * Anti-overfitting:
 * - Dropout between layers (default 0.2)
 * - L2 kernel regularization
 * - Early stopping (patience-based on validation split)
 * - Input/output standardization
 */
export class NeuralNetworkModel implements TrainableModel {
  private model: tf.LayersModel | null = null;
  private inputMean: number[] = [];
  private inputStd: number[] = [];
  private outputMean: number[] = [0, 0];
  private outputStd: number[] = [1, 1];

  private readonly epochs: number;
  private readonly batchSize: number;
  private readonly hiddenLayers: number[];
  private readonly learningRate: number;
  private readonly dropout: number;
  private readonly l2Lambda: number;
  private readonly earlyStopPatience: number;

  constructor(
    epochs: number = 200,
    batchSize: number = 32,
    hiddenLayers: number[] = [64, 32],
    learningRate: number = 0.001,
    dropout: number = 0.2,
    l2Lambda: number = 0.001,
    earlyStopPatience: number = 15,
  ) {
    this.epochs = epochs;
    this.batchSize = batchSize;
    this.hiddenLayers = hiddenLayers;
    this.learningRate = learningRate;
    this.dropout = dropout;
    this.l2Lambda = l2Lambda;
    this.earlyStopPatience = earlyStopPatience;
  }

  fit(X: number[][], yHigh: number[], yLow: number[]): void {
    // Standardize inputs
    const numFeatures = X[0].length;
    this.inputMean = new Array(numFeatures).fill(0);
    this.inputStd = new Array(numFeatures).fill(1);

    for (let j = 0; j < numFeatures; j++) {
      const col = X.map((row) => row[j]);
      this.inputMean[j] = col.reduce((s, v) => s + v, 0) / col.length;
      const variance = col.reduce((s, v) => s + (v - this.inputMean[j]) ** 2, 0) / col.length;
      this.inputStd[j] = Math.sqrt(variance) || 1;
    }

    // Standardize outputs
    this.outputMean = [
      yHigh.reduce((s, v) => s + v, 0) / yHigh.length,
      yLow.reduce((s, v) => s + v, 0) / yLow.length,
    ];
    const highVar = yHigh.reduce((s, v) => s + (v - this.outputMean[0]) ** 2, 0) / yHigh.length;
    const lowVar = yLow.reduce((s, v) => s + (v - this.outputMean[1]) ** 2, 0) / yLow.length;
    this.outputStd = [Math.sqrt(highVar) || 1, Math.sqrt(lowVar) || 1];

    // Normalize data
    const xNorm = X.map((row) => row.map((v, j) => (v - this.inputMean[j]) / this.inputStd[j]));
    const yNorm = yHigh.map((h, i) => [
      (h - this.outputMean[0]) / this.outputStd[0],
      (yLow[i] - this.outputMean[1]) / this.outputStd[1],
    ]);

    // Build model with dropout and L2 regularization
    this.model = tf.sequential();
    const sequential = this.model as tf.Sequential;

    sequential.add(tf.layers.dense({
      inputShape: [numFeatures],
      units: this.hiddenLayers[0],
      activation: "relu",
      kernelInitializer: "heNormal",
      kernelRegularizer: tf.regularizers.l2({ l2: this.l2Lambda }),
    }));
    sequential.add(tf.layers.dropout({ rate: this.dropout }));

    for (let i = 1; i < this.hiddenLayers.length; i++) {
      sequential.add(tf.layers.dense({
        units: this.hiddenLayers[i],
        activation: "relu",
        kernelInitializer: "heNormal",
        kernelRegularizer: tf.regularizers.l2({ l2: this.l2Lambda }),
      }));
      sequential.add(tf.layers.dropout({ rate: this.dropout }));
    }

    sequential.add(tf.layers.dense({ units: 2, activation: "linear" }));

    sequential.compile({
      optimizer: tf.train.adam(this.learningRate),
      loss: "meanSquaredError",
    });

    const xTensor = tf.tensor2d(xNorm);
    const yTensor = tf.tensor2d(yNorm);

    // Early stopping via custom callback
    const earlyStop = new EarlyStoppingCallback(this.earlyStopPatience);

    (this as any)._trainPromise = sequential.fit(xTensor, yTensor, {
      epochs: this.epochs,
      batchSize: this.batchSize,
      validationSplit: 0.15, // 15% for internal validation (early stopping)
      shuffle: false,
      verbose: 0,
      callbacks: [earlyStop],
    }).then(() => {
      xTensor.dispose();
      yTensor.dispose();
    });
  }

  /** Must be called after fit() since TF training is async */
  async waitForTraining(): Promise<void> {
    if ((this as any)._trainPromise) {
      await (this as any)._trainPromise;
    }
  }

  predictHigh(x: number[]): number {
    if (!this.model) return 0;
    const xNorm = x.map((v, j) => (v - this.inputMean[j]) / this.inputStd[j]);
    const pred = (this.model.predict(tf.tensor2d([xNorm])) as tf.Tensor).dataSync();
    return pred[0] * this.outputStd[0] + this.outputMean[0];
  }

  predictLow(x: number[]): number {
    if (!this.model) return 0;
    const xNorm = x.map((v, j) => (v - this.inputMean[j]) / this.inputStd[j]);
    const pred = (this.model.predict(tf.tensor2d([xNorm])) as tf.Tensor).dataSync();
    return pred[1] * this.outputStd[1] + this.outputMean[1];
  }

  serialize(): string {
    const weights: number[][] = [];
    if (this.model) {
      for (const layer of this.model.layers) {
        for (const w of layer.getWeights()) {
          weights.push(Array.from(w.dataSync()));
        }
      }
    }

    return JSON.stringify({
      type: "neural-network",
      epochs: this.epochs,
      batchSize: this.batchSize,
      hiddenLayers: this.hiddenLayers,
      learningRate: this.learningRate,
      dropout: this.dropout,
      l2Lambda: this.l2Lambda,
      earlyStopPatience: this.earlyStopPatience,
      inputMean: this.inputMean,
      inputStd: this.inputStd,
      outputMean: this.outputMean,
      outputStd: this.outputStd,
      weights,
    });
  }

  getHyperparameters(): Record<string, unknown> {
    return {
      epochs: this.epochs,
      batchSize: this.batchSize,
      hiddenLayers: this.hiddenLayers,
      learningRate: this.learningRate,
      dropout: this.dropout,
      l2Lambda: this.l2Lambda,
      earlyStopPatience: this.earlyStopPatience,
      algorithm: "neural-network",
      library: "@tensorflow/tfjs",
      regularization: "L2 + Dropout + EarlyStopping",
    };
  }

  static deserialize(json: string): NeuralNetworkModel {
    const data = JSON.parse(json);
    const model = new NeuralNetworkModel(
      data.epochs, data.batchSize, data.hiddenLayers, data.learningRate,
      data.dropout, data.l2Lambda, data.earlyStopPatience,
    );
    model.inputMean = data.inputMean;
    model.inputStd = data.inputStd;
    model.outputMean = data.outputMean;
    model.outputStd = data.outputStd;

    if (data.weights && data.weights.length > 0) {
      const numFeatures = data.inputMean.length;
      const sequential = tf.sequential();

      sequential.add(tf.layers.dense({
        inputShape: [numFeatures],
        units: data.hiddenLayers[0],
        activation: "relu",
      }));
      // Dropout layers are not needed for inference (predict always uses test mode)

      for (let i = 1; i < data.hiddenLayers.length; i++) {
        sequential.add(tf.layers.dense({
          units: data.hiddenLayers[i],
          activation: "relu",
        }));
      }

      sequential.add(tf.layers.dense({ units: 2, activation: "linear" }));
      sequential.compile({ optimizer: "adam", loss: "meanSquaredError" });

      // Restore weights (only dense layer weights, skip dropout)
      let wIdx = 0;
      for (const layer of sequential.layers) {
        const layerWeights = layer.getWeights();
        const restored: tf.Tensor[] = [];
        for (const w of layerWeights) {
          restored.push(tf.tensor(data.weights[wIdx], w.shape));
          wIdx++;
        }
        if (restored.length > 0) layer.setWeights(restored);
      }

      model.model = sequential;
    }

    return model;
  }
}

/**
 * Early stopping callback — stops training when val_loss stops improving.
 */
class EarlyStoppingCallback extends tf.Callback {
  private patience: number;
  private bestLoss: number = Infinity;
  private wait: number = 0;

  constructor(patience: number = 15) {
    super();
    this.patience = patience;
  }

  override async onEpochEnd(_epoch: number, logs?: tf.Logs): Promise<void> {
    const valLoss = logs?.val_loss ?? logs?.loss ?? Infinity;
    if (valLoss < this.bestLoss) {
      this.bestLoss = valLoss;
      this.wait = 0;
    } else {
      this.wait++;
      if (this.wait >= this.patience) {
        this.model.stopTraining = true;
      }
    }
  }
}

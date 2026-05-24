import * as tf from "@tensorflow/tfjs";
import { TrainableModel } from "./trainable-model.ts";

// Suppress TF.js logs
tf.env().set("PROD", true);

/**
 * Feedforward Neural Network for regression using TensorFlow.js.
 * Architecture: Input → Dense(64,relu) → Dense(32,relu) → Dense(2, linear)
 * Output: [predictedHigh, predictedLow]
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

  constructor(
    epochs: number = 100,
    batchSize: number = 32,
    hiddenLayers: number[] = [64, 32],
    learningRate: number = 0.001,
  ) {
    this.epochs = epochs;
    this.batchSize = batchSize;
    this.hiddenLayers = hiddenLayers;
    this.learningRate = learningRate;
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

    // Build model
    this.model = tf.sequential();
    const sequential = this.model as tf.Sequential;

    sequential.add(tf.layers.dense({
      inputShape: [numFeatures],
      units: this.hiddenLayers[0],
      activation: "relu",
      kernelInitializer: "heNormal",
    }));

    for (let i = 1; i < this.hiddenLayers.length; i++) {
      sequential.add(tf.layers.dense({
        units: this.hiddenLayers[i],
        activation: "relu",
        kernelInitializer: "heNormal",
      }));
    }

    sequential.add(tf.layers.dense({ units: 2, activation: "linear" }));

    sequential.compile({
      optimizer: tf.train.adam(this.learningRate),
      loss: "meanSquaredError",
    });

    // Train synchronously via tf
    const xTensor = tf.tensor2d(xNorm);
    const yTensor = tf.tensor2d(yNorm);

    // Note: fit is async but we use fitSync pattern (await handled by caller)
    // Store the promise to be awaited
    (this as any)._trainPromise = sequential.fit(xTensor, yTensor, {
      epochs: this.epochs,
      batchSize: this.batchSize,
      shuffle: false, // keep chronological order
      verbose: 0,
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
    // TF.js models can't easily serialize to a single JSON string,
    // so we store the normalization params and weights
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
      inputMean: this.inputMean,
      inputStd: this.inputStd,
      outputMean: this.outputMean,
      outputStd: this.outputStd,
      weights,
      architecture: this.model ? (this.model as tf.Sequential).layers.map((l) => ({
        units: (l as any).units,
        activation: (l as any).activation?.getClassName?.() || "linear",
      })) : [],
    });
  }

  getHyperparameters(): Record<string, unknown> {
    return {
      epochs: this.epochs,
      batchSize: this.batchSize,
      hiddenLayers: this.hiddenLayers,
      learningRate: this.learningRate,
      algorithm: "neural-network",
      library: "@tensorflow/tfjs",
    };
  }

  static deserialize(json: string): NeuralNetworkModel {
    const data = JSON.parse(json);
    const model = new NeuralNetworkModel(
      data.epochs, data.batchSize, data.hiddenLayers, data.learningRate,
    );
    model.inputMean = data.inputMean;
    model.inputStd = data.inputStd;
    model.outputMean = data.outputMean;
    model.outputStd = data.outputStd;

    // Rebuild architecture and load weights
    if (data.weights && data.weights.length > 0 && data.architecture) {
      const numFeatures = data.inputMean.length;
      const sequential = tf.sequential();

      sequential.add(tf.layers.dense({
        inputShape: [numFeatures],
        units: data.hiddenLayers[0],
        activation: "relu",
      }));

      for (let i = 1; i < data.hiddenLayers.length; i++) {
        sequential.add(tf.layers.dense({
          units: data.hiddenLayers[i],
          activation: "relu",
        }));
      }

      sequential.add(tf.layers.dense({ units: 2, activation: "linear" }));
      sequential.compile({ optimizer: "adam", loss: "meanSquaredError" });

      // Restore weights
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

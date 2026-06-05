import "../config/env.ts";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { readdirSync, readFileSync, existsSync, mkdirSync } from "fs";
// @ts-ignore
import * as tf from "@tensorflow/tfjs";
import BaseScript from "./base-script.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OHLCV_DIR = resolve(__dirname, "..", "..", "..", "..", "data", "daily-ohlcv");
const MODEL_DIR = resolve(__dirname, "..", "..", "..", "..", "data", "models", "signal-lstm");

const SEQUENCE_LENGTH = 60;
const PREDICTION_HORIZON = 10;
const BUY_THRESHOLD = 5;
const SELL_THRESHOLD = -5;
const EPOCHS = 50;
const BATCH_SIZE = 128;
const LEARNING_RATE = 0.001;
const EARLY_STOPPING_PATIENCE = 5;

const TRAIN_CUTOFF = "2026-01-01";
const VAL_CUTOFF = "2026-04-01";

interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Sample {
  x: number[][];
  label: number;
  date: string;
}

class SignalModelScript extends BaseScript {
  get scriptName(): string {
    return "signal-model";
  }

  protected getMetadata(): Record<string, unknown> {
    return {};
  }

  protected async run(): Promise<void> {
    if (process.argv.includes("--train")) {
      await this.train();
    } else if (process.argv.includes("--backtest")) {
      await this.backtest();
    } else {
      await this.predict();
    }
  }

  // ─── Training ──────────────────────────────────────────────────────

  private async train(): Promise<void> {
    this.log.info("Generating samples...");
    const samples = this.generateSamples();

    const trainSamples = samples.filter((s) => s.date < TRAIN_CUTOFF);
    const valSamples = samples.filter((s) => s.date >= TRAIN_CUTOFF && s.date < VAL_CUTOFF);
    const testSamples = samples.filter((s) => s.date >= VAL_CUTOFF);

    this.log.info(`Train: ${trainSamples.length} | Val: ${valSamples.length} | Test: ${testSamples.length}`);

    const trainClassCounts = [0, 0, 0];
    for (const s of trainSamples) trainClassCounts[s.label]++;
    this.log.info(`Train classes — Buy: ${trainClassCounts[0]} | Hold: ${trainClassCounts[1]} | Sell: ${trainClassCounts[2]}`);

    const totalTrain = trainSamples.length;
    const classWeights = {
      0: totalTrain / (3 * trainClassCounts[0] || 1),
      1: totalTrain / (3 * trainClassCounts[1] || 1),
      2: totalTrain / (3 * trainClassCounts[2] || 1),
    };
    this.log.info(`Class weights — Buy: ${classWeights[0].toFixed(2)} | Hold: ${classWeights[1].toFixed(2)} | Sell: ${classWeights[2].toFixed(2)}`);

    this.log.info("Creating tensors...");
    const trainXData = trainSamples.map((s) => s.x);
    const trainYData = trainSamples.map((s) => s.label);
    const valXData = valSamples.map((s) => s.x);
    const valYData = valSamples.map((s) => s.label);
    // Free sample objects
    trainSamples.length = 0;
    valSamples.length = 0;

    const trainXs = tf.tensor3d(trainXData);
    trainXData.length = 0;
    const trainYs = tf.oneHot(tf.tensor1d(trainYData, "int32"), 3);
    trainYData.length = 0;
    const valXs = tf.tensor3d(valXData);
    valXData.length = 0;
    const valYs = tf.oneHot(tf.tensor1d(valYData, "int32"), 3);
    valYData.length = 0;

    this.log.info("Building model...");
    const model = this.buildModel();
    model.summary();

    this.log.info(`Training (epochs=${EPOCHS}, batch=${BATCH_SIZE}, patience=${EARLY_STOPPING_PATIENCE})...`);

    let bestValLoss = Infinity;
    let patienceCounter = 0;

    for (let epoch = 0; epoch < EPOCHS; epoch++) {
      const history = await model.fit(trainXs, trainYs, {
        epochs: 1,
        batchSize: BATCH_SIZE,
        validationData: [valXs, valYs],
        classWeight: classWeights,
        shuffle: true,
      });

      const loss = (history.history.loss[0] as number).toFixed(4);
      const acc = (history.history.acc[0] as number).toFixed(4);
      const valLoss = history.history.val_loss[0] as number;
      const valAcc = (history.history.val_acc[0] as number).toFixed(4);

      this.log.info(`  Epoch ${epoch + 1}/${EPOCHS} — loss: ${loss} acc: ${acc} val_loss: ${valLoss.toFixed(4)} val_acc: ${valAcc}`);

      if (valLoss < bestValLoss) {
        bestValLoss = valLoss;
        patienceCounter = 0;
        mkdirSync(MODEL_DIR, { recursive: true });
        await model.save(`file://${MODEL_DIR}`);
      } else {
        patienceCounter++;
        if (patienceCounter >= EARLY_STOPPING_PATIENCE) {
          this.log.info(`  Early stopping at epoch ${epoch + 1}`);
          break;
        }
      }
    }

    // Evaluate on test set
    this.log.info("\nEvaluating on test set...");
    const bestModel = await tf.loadLayersModel(`file://${MODEL_DIR}/model.json`);
    const testXs = tf.tensor3d(testSamples.map((s) => s.x));
    const testPredictions = (bestModel.predict(testXs) as tf.Tensor).argMax(-1).arraySync() as number[];
    const testLabels = testSamples.map((s) => s.label);

    const confusion = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < testLabels.length; i++) {
      confusion[testLabels[i]][testPredictions[i]]++;
    }

    const classNames = ["Buy", "Hold", "Sell"];
    this.log.info("\nConfusion matrix (rows=actual, cols=predicted):");
    this.log.info(`${"".padEnd(8)}${"Buy".padStart(8)}${"Hold".padStart(8)}${"Sell".padStart(8)}`);
    for (let i = 0; i < 3; i++) {
      this.log.info(`${classNames[i].padEnd(8)}${String(confusion[i][0]).padStart(8)}${String(confusion[i][1]).padStart(8)}${String(confusion[i][2]).padStart(8)}`);
    }

    for (let c = 0; c < 3; c++) {
      const tp = confusion[c][c];
      const predicted = confusion[0][c] + confusion[1][c] + confusion[2][c];
      const actual = confusion[c][0] + confusion[c][1] + confusion[c][2];
      const precision = predicted > 0 ? (tp / predicted * 100).toFixed(1) : "0.0";
      const recall = actual > 0 ? (tp / actual * 100).toFixed(1) : "0.0";
      this.log.info(`${classNames[c]}: precision=${precision}% recall=${recall}%`);
    }

    const correct = testPredictions.filter((p, i) => p === testLabels[i]).length;
    this.log.info(`\nTest accuracy: ${(correct / testLabels.length * 100).toFixed(1)}%`);
    this.log.info(`Model saved to ${MODEL_DIR}`);

    trainXs.dispose(); trainYs.dispose(); valXs.dispose(); valYs.dispose(); testXs.dispose();
  }

  // ─── Prediction ────────────────────────────────────────────────────

  private async predict(): Promise<void> {
    if (!existsSync(resolve(MODEL_DIR, "model.json"))) {
      this.log.error("No trained model found. Run with --train first.");
      return;
    }

    this.log.info("Loading model...");
    const model = await tf.loadLayersModel(`file://${MODEL_DIR}/model.json`);

    const files = readdirSync(OHLCV_DIR).filter((f) => f.endsWith(".json") && f !== "NIFTY50.json");
    const signals: { symbol: string; signal: string; confidence: number; price: number }[] = [];

    for (const file of files) {
      const symbol = file.replace(".json", "");
      try {
        const candles = this.loadCandles(file);
        if (candles.length < SEQUENCE_LENGTH) continue;

        const seq = candles.slice(-SEQUENCE_LENGTH);
        const normalized = this.normalizeSequence(seq);
        const input = tf.tensor3d([normalized]);
        const prediction = model.predict(input) as tf.Tensor;
        const probs = (prediction.arraySync() as number[][])[0];
        input.dispose();
        prediction.dispose();

        const maxIdx = probs.indexOf(Math.max(...probs));
        const signal = maxIdx === 0 ? "BUY" : maxIdx === 2 ? "SELL" : "HOLD";
        const confidence = probs[maxIdx];

        if (signal !== "HOLD") {
          signals.push({ symbol, signal, confidence, price: candles[candles.length - 1].close });
        }
      } catch {}
    }

    signals.sort((a, b) => b.confidence - a.confidence);
    const buys = signals.filter((s) => s.signal === "BUY");
    const sells = signals.filter((s) => s.signal === "SELL");

    this.log.info(`\n${"═".repeat(70)}`);
    this.log.info(`SIGNALS — ${buys.length} BUY, ${sells.length} SELL (${files.length} stocks scanned)`);
    this.log.info(`${"═".repeat(70)}`);

    if (buys.length > 0) {
      this.log.info("\nBUY signals (top 20):");
      for (const s of buys.slice(0, 20)) {
        this.log.info(`  ${s.symbol.padEnd(15)} Price: ${s.price.toFixed(2).padStart(8)} | Confidence: ${(s.confidence * 100).toFixed(1)}%`);
      }
    }
    if (sells.length > 0) {
      this.log.info("\nSELL signals (top 20):");
      for (const s of sells.slice(0, 20)) {
        this.log.info(`  ${s.symbol.padEnd(15)} Price: ${s.price.toFixed(2).padStart(8)} | Confidence: ${(s.confidence * 100).toFixed(1)}%`);
      }
    }
  }

  // ─── Backtest ──────────────────────────────────────────────────────

  private async backtest(): Promise<void> {
    if (!existsSync(resolve(MODEL_DIR, "model.json"))) {
      this.log.error("No trained model found. Run with --train first.");
      return;
    }

    this.log.info("Loading model and running backtest on test period...");
    const model = await tf.loadLayersModel(`file://${MODEL_DIR}/model.json`);

    const files = readdirSync(OHLCV_DIR).filter((f) => f.endsWith(".json") && f !== "NIFTY50.json");
    let totalTrades = 0, wins = 0, losses = 0, totalPnl = 0;
    const monthlyPnl = new Map<string, { trades: number; pnl: number; wins: number }>();

    for (const file of files) {
      try {
        const candles = this.loadCandles(file);
        if (candles.length < SEQUENCE_LENGTH + PREDICTION_HORIZON) continue;

        for (let i = SEQUENCE_LENGTH; i < candles.length - PREDICTION_HORIZON; i++) {
          const date = candles[i].timestamp.split(" ")[0];
          if (date < VAL_CUTOFF) continue;

          const seq = candles.slice(i - SEQUENCE_LENGTH, i);
          const normalized = this.normalizeSequence(seq);
          const input = tf.tensor3d([normalized]);
          const prediction = model.predict(input) as tf.Tensor;
          const probs = (prediction.arraySync() as number[][])[0];
          input.dispose();
          prediction.dispose();

          const maxIdx = probs.indexOf(Math.max(...probs));
          if (maxIdx === 1) continue; // Hold — skip

          const buyPrice = candles[i].close;
          const futurePrice = candles[i + PREDICTION_HORIZON - 1].close;
          const pnl = maxIdx === 0
            ? futurePrice - buyPrice
            : buyPrice - futurePrice; // Sell signal = short

          totalTrades++;
          totalPnl += pnl;
          if (pnl > 0) wins++; else losses++;

          const month = date.slice(0, 7);
          const m = monthlyPnl.get(month) ?? { trades: 0, pnl: 0, wins: 0 };
          m.trades++;
          m.pnl += pnl;
          if (pnl > 0) m.wins++;
          monthlyPnl.set(month, m);
        }
      } catch {}
    }

    this.log.info(`\n${"═".repeat(70)}`);
    this.log.info("BACKTEST RESULTS (test period)");
    this.log.info(`${"═".repeat(70)}`);
    this.log.info(`Total trades: ${totalTrades}`);
    this.log.info(`Winners: ${wins} | Losers: ${losses}`);
    this.log.info(`Win rate: ${totalTrades > 0 ? (wins / totalTrades * 100).toFixed(1) : 0}%`);
    this.log.info(`Total P&L: ₹${totalPnl.toFixed(2)} (per unit)`);

    this.log.info(`\n${"Month".padEnd(10)}${"Trades".padStart(8)}${"Wins".padStart(7)}${"Win%".padStart(7)}${"P&L".padStart(12)}`);
    this.log.info("-".repeat(44));
    for (const [month, data] of [...monthlyPnl.entries()].sort()) {
      const wr = data.trades > 0 ? (data.wins / data.trades * 100).toFixed(0) : "0";
      this.log.info(`${month.padEnd(10)}${String(data.trades).padStart(8)}${String(data.wins).padStart(7)}${(wr + "%").padStart(7)}${data.pnl.toFixed(2).padStart(12)}`);
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private generateSamples(): Sample[] {
    const files = readdirSync(OHLCV_DIR).filter((f) => f.endsWith(".json") && f !== "NIFTY50.json");
    const allSamples: Sample[] = [];

    let processed = 0;
    for (const file of files) {
      try {
        const candles = this.loadCandles(file);
        if (candles.length < SEQUENCE_LENGTH + PREDICTION_HORIZON) continue;

        // Sample every 5th window to reduce dataset size
        for (let i = SEQUENCE_LENGTH; i < candles.length - PREDICTION_HORIZON; i += 5) {
          const seq = candles.slice(i - SEQUENCE_LENGTH, i);
          const currentPrice = candles[i - 1].close;
          const futurePrice = candles[i + PREDICTION_HORIZON - 1].close;
          const returnPct = ((futurePrice - currentPrice) / currentPrice) * 100;

          let label: number;
          if (returnPct >= BUY_THRESHOLD) label = 0;
          else if (returnPct <= SELL_THRESHOLD) label = 2;
          else label = 1;

          const date = candles[i].timestamp.split(" ")[0];
          allSamples.push({ x: this.normalizeSequence(seq), label, date });
        }
      } catch {}
      processed++;
      if (processed % 200 === 0) this.log.info(`  Processed ${processed}/${files.length} stocks (${allSamples.length} samples)`);
    }

    this.log.info(`Generated ${allSamples.length} samples from ${processed} stocks`);
    return allSamples;
  }

  private normalizeSequence(candles: Candle[]): number[][] {
    const firstClose = candles[0].close;
    const maxVolume = Math.max(...candles.map((c) => c.volume)) || 1;

    return candles.map((c) => [
      c.open / firstClose - 1,
      c.high / firstClose - 1,
      c.low / firstClose - 1,
      c.close / firstClose - 1,
      c.volume / maxVolume,
    ]);
  }

  private buildModel(): tf.LayersModel {
    const model = tf.sequential();

    model.add(tf.layers.lstm({
      units: 64,
      returnSequences: true,
      inputShape: [SEQUENCE_LENGTH, 5],
    }));
    model.add(tf.layers.dropout({ rate: 0.3 }));

    model.add(tf.layers.lstm({ units: 64 }));
    model.add(tf.layers.dropout({ rate: 0.3 }));

    model.add(tf.layers.dense({
      units: 32,
      activation: "relu",
      kernelRegularizer: tf.regularizers.l2({ l2: 0.001 }),
    }));

    model.add(tf.layers.dense({ units: 3, activation: "softmax" }));

    model.compile({
      optimizer: tf.train.adam(LEARNING_RATE),
      loss: "categoricalCrossentropy",
      metrics: ["accuracy"],
    });

    return model;
  }

  private loadCandles(file: string): Candle[] {
    const content = readFileSync(resolve(OHLCV_DIR, file), "utf-8");
    return JSON.parse(content) as Candle[];
  }
}

new SignalModelScript().start();

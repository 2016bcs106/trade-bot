import createLogger from "../utils/logger.ts";
import { QueuedRequest } from "../firebase/client.ts";
import { RequestHandler, ServiceContext } from "./request-handler.ts";
import ShortHorizonFeatures from "../features/short-horizon-features.ts";
import ShortHorizonPredictor from "../prediction/short-horizon-predictor.ts";

const logger = createLogger("handler:short-predict-dry-run");

/**
 * Handles "short_predict_dry_run" requests.
 *
 * Fetches OHLCV data for a given past date, runs the short-horizon predictor
 * for every minute of the day (starting from minute 30), and saves both the
 * predicted price and the actual price 5 minutes later to Firebase at:
 *   short_horizon_predictions_dry_run/{symbol}/{date}/{HH:mm}
 *
 * Expected payload:
 * - symbol: string (stock symbol)
 * - date: string (YYYY-MM-DD, must be a past date)
 */
export class ShortPredictDryRunHandler implements RequestHandler {
  async handle(request: QueuedRequest, ctx: ServiceContext): Promise<void> {
    const { symbol, date } = request.payload as {
      symbol: string;
      date: string;
    };

    if (!symbol || !date) {
      throw new Error("short_predict_dry_run requires payload: { symbol, date }");
    }

    const { firebase, paytm, modelManager } = ctx;

    const stock = await firebase.getStock(symbol);
    if (!stock || !stock.currentProductionVersion) {
      throw new Error(`No production model for ${symbol}`);
    }

    const pmlId = stock.pmlId;
    if (!pmlId) {
      throw new Error(`Stock ${symbol} has no pmlId`);
    }

    const version = stock.currentProductionVersion;

    logger.info(`Short predict dry-run: ${symbol}@${date} using ${version}`);

    // Fetch candles for that day
    const candles = await paytm.fetchOHLCV(pmlId, date, date);

    if (candles.length < ShortHorizonFeatures.LOOKBACK + 5) {
      throw new Error(`Insufficient candles for ${symbol}@${date}: only ${candles.length} (need ≥${ShortHorizonFeatures.LOOKBACK + 5})`);
    }

    logger.info(`Fetched ${candles.length} candles for ${symbol}@${date}`);

    const predictor = new ShortHorizonPredictor();
    let predictionCount = 0;
    let correctDirection = 0;
    let totalAbsError = 0;

    // Slide through the day: for each minute from index 29 to (length - 5)
    for (let i = ShortHorizonFeatures.LOOKBACK - 1; i < candles.length - 5; i++) {
      const windowCandles = candles.slice(i - ShortHorizonFeatures.LOOKBACK + 1, i + 1);
      const prediction = predictor.predict(symbol, date, windowCandles, version);

      if (!prediction) continue;

      // Actual price 5 minutes later
      const actualPrice = candles[i + 5].close;
      const currentPrice = candles[i].close;
      const actualReturn = currentPrice > 0 ? (actualPrice - currentPrice) / currentPrice : 0;

      // Evaluate directional accuracy
      const predDir = prediction.predictedReturn >= 0;
      const actualDir = actualReturn >= 0;
      if (predDir === actualDir) correctDirection++;

      // Absolute error
      const absError = Math.abs(prediction.predictedPrice - actualPrice);
      totalAbsError += absError;
      predictionCount++;

      // Save to Firebase
      const record = {
        time: prediction.time,
        currentPrice: prediction.currentPrice,
        predictedPrice: prediction.predictedPrice,
        predictedReturn: prediction.predictedReturn,
        direction: prediction.direction,
        confidence: prediction.confidence,
        actualPrice,
        actualReturn: Math.round(actualReturn * 100000) / 100000,
        error: Math.round((absError / actualPrice) * 10000) / 10000, // percentage error
        directionCorrect: predDir === actualDir,
      };

      // Firebase path: short_horizon_predictions_dry_run/{symbol}/{date}/{HH:mm}
      const timePath = prediction.time.replace(":", "-"); // Firebase keys can't have ':'
      await firebase._setValuePublic(
        `short_horizon_predictions_dry_run/${symbol}/${date}/${timePath}`,
        record,
      );
    }

    const dirAccuracy = predictionCount > 0 ? (correctDirection / predictionCount) * 100 : 0;
    const avgError = predictionCount > 0 ? totalAbsError / predictionCount : 0;

    logger.info(`✓ ${symbol}@${date}: ${predictionCount} predictions, Dir=${dirAccuracy.toFixed(1)}%, AvgErr=₹${avgError.toFixed(2)}`);

    // Save summary
    await firebase._setValuePublic(
      `short_horizon_predictions_dry_run/${symbol}/${date}/_summary`,
      {
        symbol,
        date,
        modelVersion: version,
        totalPredictions: predictionCount,
        directionalAccuracy: Math.round(dirAccuracy * 10) / 10,
        avgAbsoluteError: Math.round(avgError * 100) / 100,
        generatedAt: new Date().toISOString(),
      },
    );
  }
}

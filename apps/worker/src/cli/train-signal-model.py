"""
LSTM Signal Model Trainer
Trains a Buy/Hold/Sell model on daily OHLCV data and exports to ONNX.

Usage: python3 train.py [--epochs 30] [--device mps|cpu]
"""

import json
import os
import glob
import argparse
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "data", "daily-ohlcv")
MODEL_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "data", "models", "signal-lstm")

SEQUENCE_LENGTH = 60
PREDICTION_HORIZON = 10
TRAIN_CUTOFF = "2026-01-01"
VAL_CUTOFF = "2026-04-01"
BATCH_SIZE = 256
LEARNING_RATE = 0.001
SAMPLE_STEP = 5
NUM_FEATURES = 14


class LSTMModel(nn.Module):
    """Predicts max upside % and max downside % over the prediction horizon."""
    def __init__(self, input_size=NUM_FEATURES, hidden_size=24, num_layers=2, dropout=0.2):
        super().__init__()
        self.lstm = nn.LSTM(input_size, hidden_size, num_layers, batch_first=True, dropout=dropout)
        self.dropout = nn.Dropout(dropout)
        self.fc1 = nn.Linear(hidden_size, 8)
        self.relu = nn.ReLU()
        self.fc2 = nn.Linear(8, 2)  # [max_upside_pct, max_downside_pct]

    def forward(self, x):
        _, (h_n, _) = self.lstm(x)
        out = self.dropout(h_n[-1])
        out = self.relu(self.fc1(out))
        out = self.fc2(out)
        return out


def compute_rsi(closes, period=14):
    """Relative Strength Index"""
    rsi = [0.0] * len(closes)
    if len(closes) < period + 1:
        return rsi
    gains, losses = 0.0, 0.0
    for i in range(1, period + 1):
        diff = closes[i] - closes[i - 1]
        if diff > 0: gains += diff
        else: losses -= diff
    avg_gain = gains / period
    avg_loss = losses / period
    rs = avg_gain / avg_loss if avg_loss > 0 else 100
    rsi[period] = 100 - 100 / (1 + rs)
    for i in range(period + 1, len(closes)):
        diff = closes[i] - closes[i - 1]
        gain = diff if diff > 0 else 0
        loss = -diff if diff < 0 else 0
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
        rs = avg_gain / avg_loss if avg_loss > 0 else 100
        rsi[i] = 100 - 100 / (1 + rs)
    return rsi


def compute_sma(values, period):
    sma = [0.0] * len(values)
    for i in range(period - 1, len(values)):
        sma[i] = sum(values[i - period + 1:i + 1]) / period
    return sma


def compute_ema(values, period):
    ema = [0.0] * len(values)
    if len(values) < period:
        return ema
    ema[period - 1] = sum(values[:period]) / period
    mult = 2.0 / (period + 1)
    for i in range(period, len(values)):
        ema[i] = (values[i] - ema[i - 1]) * mult + ema[i - 1]
    return ema


def compute_atr(highs, lows, closes, period=14):
    atr = [0.0] * len(closes)
    if len(closes) < period + 1:
        return atr
    trs = []
    for i in range(1, len(closes)):
        tr = max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1]))
        trs.append(tr)
    # first ATR
    atr[period] = sum(trs[:period]) / period
    for i in range(period + 1, len(closes)):
        atr[i] = (atr[i - 1] * (period - 1) + trs[i - 1]) / period
    return atr


def build_features(candles):
    """
    Build feature matrix from raw OHLCV candles.
    Features per timestep (14):
      0-3: normalized OHLC (relative to first close)
      4: normalized volume
      5: daily return %
      6: RSI (0-1 scaled)
      7: price vs SMA20 ratio
      8: price vs EMA9 ratio
      9: ATR % (volatility)
      10: volume ratio (vs 20-day avg)
      11: upper shadow ratio
      12: lower shadow ratio
      13: body ratio (close-open / high-low)
    """
    opens = [c[0] for c in candles]
    highs = [c[1] for c in candles]
    lows = [c[2] for c in candles]
    closes = [c[3] for c in candles]
    volumes = [c[4] for c in candles]

    first_close = closes[0] or 1
    max_volume = max(volumes) or 1

    rsi = compute_rsi(closes)
    sma20 = compute_sma(closes, 20)
    ema9 = compute_ema(closes, 9)
    atr = compute_atr(highs, lows, closes)
    vol_sma = compute_sma(volumes, 20)

    features = []
    for i in range(len(candles)):
        o, h, l, c, v = candles[i]
        daily_ret = (c - closes[i - 1]) / closes[i - 1] if i > 0 and closes[i - 1] != 0 else 0
        hl_range = h - l if h != l else 1

        features.append([
            o / first_close - 1,
            h / first_close - 1,
            l / first_close - 1,
            c / first_close - 1,
            v / max_volume,
            daily_ret,
            rsi[i] / 100.0,
            (c / sma20[i] - 1) if sma20[i] > 0 else 0,
            (c / ema9[i] - 1) if ema9[i] > 0 else 0,
            atr[i] / c if c > 0 else 0,
            v / vol_sma[i] if vol_sma[i] > 0 else 0,
            (h - max(o, c)) / hl_range,
            (min(o, c) - l) / hl_range,
            (c - o) / hl_range,
        ])
    return features


def load_data():
    files = sorted(glob.glob(os.path.join(DATA_DIR, "*.json")))
    files = [f for f in files if "NIFTY50" not in f]

    train_x, train_y = [], []
    val_x, val_y = [], []
    test_x, test_y = [], []

    for i, filepath in enumerate(files):
        try:
            with open(filepath) as f:
                raw = json.load(f)
            if len(raw) < SEQUENCE_LENGTH + PREDICTION_HORIZON:
                continue

            candles = [(c["open"], c["high"], c["low"], c["close"], c["volume"]) for c in raw]
            timestamps = [c["timestamp"].split(" ")[0] for c in raw]
            all_features = build_features(candles)

            for j in range(SEQUENCE_LENGTH, len(candles) - PREDICTION_HORIZON, SAMPLE_STEP):
                current_price = candles[j - 1][3]
                if current_price == 0:
                    continue

                # Max high and min low in the next PREDICTION_HORIZON days
                future_highs = [candles[k][1] for k in range(j, j + PREDICTION_HORIZON)]
                future_lows = [candles[k][2] for k in range(j, j + PREDICTION_HORIZON)]
                max_upside = (max(future_highs) - current_price) / current_price * 100
                max_downside = (min(future_lows) - current_price) / current_price * 100

                seq_features = all_features[j - SEQUENCE_LENGTH:j]
                date = timestamps[j]

                target = [max_upside, max_downside]

                if date < TRAIN_CUTOFF:
                    train_x.append(seq_features)
                    train_y.append(target)
                elif date < VAL_CUTOFF:
                    val_x.append(seq_features)
                    val_y.append(target)
                else:
                    test_x.append(seq_features)
                    test_y.append(target)

        except Exception:
            continue

        if (i + 1) % 200 == 0:
            print(f"  Processed {i + 1}/{len(files)} stocks ({len(train_x) + len(val_x) + len(test_x)} samples)")

    print(f"  Total: train={len(train_x)} val={len(val_x)} test={len(test_x)}")
    return (
        torch.tensor(train_x, dtype=torch.float32), torch.tensor(train_y, dtype=torch.float32),
        torch.tensor(val_x, dtype=torch.float32), torch.tensor(val_y, dtype=torch.float32),
        torch.tensor(test_x, dtype=torch.float32), torch.tensor(test_y, dtype=torch.float32),
    )


def train(args):
    device = torch.device(args.device if args.device != "mps" or torch.backends.mps.is_available() else "cpu")
    print(f"Device: {device}")

    print("Loading data...")
    train_x, train_y, val_x, val_y, test_x, test_y = load_data()

    print(f"Target stats — upside: mean={train_y[:, 0].mean():.2f}% std={train_y[:, 0].std():.2f}%")
    print(f"             — downside: mean={train_y[:, 1].mean():.2f}% std={train_y[:, 1].std():.2f}%")

    train_ds = DataLoader(TensorDataset(train_x, train_y), batch_size=BATCH_SIZE, shuffle=True)
    val_ds = DataLoader(TensorDataset(val_x, val_y), batch_size=BATCH_SIZE)

    model = LSTMModel().to(device)
    print(f"Model params: {sum(p.numel() for p in model.parameters()):,}")

    criterion = nn.MSELoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=LEARNING_RATE)

    best_val_loss = float("inf")
    patience_counter = 0
    patience = 5

    for epoch in range(args.epochs):
        model.train()
        total_loss, total = 0, 0
        for xb, yb in train_ds:
            xb, yb = xb.to(device), yb.to(device)
            out = model(xb)
            loss = criterion(out, yb)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            total_loss += loss.item() * xb.size(0)
            total += xb.size(0)

        train_loss = total_loss / total

        model.eval()
        val_loss, val_total = 0, 0
        with torch.no_grad():
            for xb, yb in val_ds:
                xb, yb = xb.to(device), yb.to(device)
                out = model(xb)
                val_loss += criterion(out, yb).item() * xb.size(0)
                val_total += xb.size(0)

        val_loss /= val_total
        val_mae_up, val_mae_down = 0, 0
        with torch.no_grad():
            all_preds, all_targets = [], []
            for xb, yb in val_ds:
                xb = xb.to(device)
                preds = model(xb).cpu()
                all_preds.append(preds)
                all_targets.append(yb)
            all_preds = torch.cat(all_preds)
            all_targets = torch.cat(all_targets)
            val_mae_up = (all_preds[:, 0] - all_targets[:, 0]).abs().mean().item()
            val_mae_down = (all_preds[:, 1] - all_targets[:, 1]).abs().mean().item()

        print(f"  Epoch {epoch + 1}/{args.epochs} — loss: {train_loss:.4f} val_loss: {val_loss:.4f} val_MAE: upside={val_mae_up:.2f}% downside={val_mae_down:.2f}%")

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            patience_counter = 0
            os.makedirs(MODEL_DIR, exist_ok=True)
            torch.save(model.state_dict(), os.path.join(MODEL_DIR, "model.pt"))
        else:
            patience_counter += 1
            if patience_counter >= patience:
                print(f"  Early stopping at epoch {epoch + 1}")
                break

    # Evaluate on test set
    print("\nEvaluating on test set...")
    model.load_state_dict(torch.load(os.path.join(MODEL_DIR, "model.pt"), weights_only=True))
    model.eval()

    test_ds = DataLoader(TensorDataset(test_x, test_y), batch_size=BATCH_SIZE)
    all_preds, all_targets = [], []
    with torch.no_grad():
        for xb, yb in test_ds:
            xb = xb.to(device)
            preds = model(xb).cpu()
            all_preds.append(preds)
            all_targets.append(yb)
    all_preds = torch.cat(all_preds)
    all_targets = torch.cat(all_targets)

    mae_up = (all_preds[:, 0] - all_targets[:, 0]).abs().mean().item()
    mae_down = (all_preds[:, 1] - all_targets[:, 1]).abs().mean().item()
    print(f"Test MAE — upside: {mae_up:.2f}% | downside: {mae_down:.2f}%")

    # Direction accuracy: if predicted upside > |predicted downside|, we call it bullish
    pred_bullish = all_preds[:, 0] > all_preds[:, 1].abs()
    actual_bullish = all_targets[:, 0] > all_targets[:, 1].abs()
    direction_acc = (pred_bullish == actual_bullish).float().mean().item()
    print(f"Direction accuracy: {direction_acc * 100:.1f}%")

    # Simulated trading: buy when predicted risk/reward > 2
    reward_risk = all_preds[:, 0] / all_preds[:, 1].abs().clamp(min=0.1)
    strong_buys = reward_risk > 2
    if strong_buys.sum() > 0:
        actual_upside = all_targets[strong_buys, 0]
        actual_downside = all_targets[strong_buys, 1]
        print(f"\nStrong buy signals (reward/risk > 2): {strong_buys.sum().item()}")
        print(f"  Actual avg upside: +{actual_upside.mean():.2f}%")
        print(f"  Actual avg downside: {actual_downside.mean():.2f}%")
        print(f"  % that went up > 5%: {(actual_upside > 5).float().mean() * 100:.1f}%")
        print(f"  % that went down > 5%: {(actual_downside < -5).float().mean() * 100:.1f}%")

    # Strong sell signals
    strong_sells = reward_risk < 0.5
    if strong_sells.sum() > 0:
        actual_upside = all_targets[strong_sells, 0]
        actual_downside = all_targets[strong_sells, 1]
        print(f"\nStrong sell signals (reward/risk < 0.5): {strong_sells.sum().item()}")
        print(f"  Actual avg upside: +{actual_upside.mean():.2f}%")
        print(f"  Actual avg downside: {actual_downside.mean():.2f}%")
        print(f"  % that went down > 5%: {(actual_downside < -5).float().mean() * 100:.1f}%")

    # Export to ONNX
    print("\nExporting to ONNX...")
    model.cpu()
    dummy = torch.randn(1, SEQUENCE_LENGTH, NUM_FEATURES)
    onnx_path = os.path.join(MODEL_DIR, "model.onnx")
    try:
        torch.onnx.export(model, dummy, onnx_path, input_names=["input"], output_names=["output"],
                          dynamic_axes={"input": {0: "batch"}, "output": {0: "batch"}})
        print(f"ONNX model saved to {onnx_path}")
    except Exception as e:
        print(f"ONNX export failed: {e}")
        print("PyTorch model (.pt) is still available for inference")

    print(f"\nDone! Model at {MODEL_DIR}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--device", type=str, default="mps")
    args = parser.parse_args()
    train(args)

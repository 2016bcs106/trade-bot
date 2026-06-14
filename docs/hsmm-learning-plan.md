# HSMM Learning & Implementation Plan

## Goal

Implement a Hidden Semi-Markov Model (HSMM) from scratch to detect intraday
market regimes and predict their expected remaining duration.

**You write all the code and derivations.** Claude acts strictly as advisor:
verifying math, reviewing your code for correctness and numerical issues, and
helping design the integration architecture once the engine is validated
offline. Claude does not write production code for this module.

## Phase 0 — Foundations (full review)

- [ ] Markov chains: states, transition matrix, stationary distribution
- [ ] Conditional probability / Bayes' rule refresher
- [ ] Gaussian & multivariate Gaussian likelihood, log-likelihood
- [ ] Why log-space arithmetic (log-sum-exp) is used throughout

**Checkpoint**: walk through a tiny 2-state Markov chain by hand together
before writing any code.

## Phase 1 — Standard HMM from scratch

- [ ] Define the model: states, transition matrix `A`, emission params `B`, initial dist `π`
- [ ] Forward algorithm (`α`) — sequence likelihood / filtering
- [ ] Backward algorithm (`β`)
- [ ] Forward-backward → `γ` (state posteriors), `ξ` (transition posteriors)
- [ ] Viterbi — most likely state path
- [ ] Baum-Welch (EM) — re-estimate `A`, `B`, `π`
- [ ] Validate on synthetic data with known generating params (recover them via EM)
- [ ] Apply to real 1-min OHLCV features (returns, realized vol, volume z-score)
      and sanity-check regimes against a chart

**Checkpoint**: numeric walkthrough on a tiny (3–5 obs, 2-state) example —
compare your `α`/`β`/`γ` values against hand-computed ones before moving on.

## Phase 2 — HSMM extensions (explicit duration)

- [ ] Why HMM's implicit geometric sojourn time misrepresents regime persistence
- [ ] Explicit per-state duration distributions (start simple: non-parametric
      histogram, or negative binomial)
- [ ] Generalized forward-backward for HSMM (e.g. Yu & Kobayashi formulation)
- [ ] Segmental Viterbi for HSMM
- [ ] EM updates for transition probs + duration distribution params
- [ ] Validate against synthetic data with known durations

**Checkpoint**: derive and verify the HSMM forward recursion together before
coding it; review numerical stability of the implementation afterward.

## Phase 3 — Apply to market regimes

- [x] Define regimes (e.g. trending-up, trending-down, range-bound, high-vol
      breakout) and the feature vector
- [x] Train on historical OHLCV (existing `fetch-daily-ohlcv` pipeline)
- [x] Walk-forward validation — no lookahead
- [x] Evaluate regime classification stability + duration prediction error vs
      actual sojourn times

**Checkpoint**: review evaluation methodology for lookahead bias and metric choice.

## Phase 4 — Integration into worker (only after Phase 3 is validated)

- [ ] Module layout under `apps/worker/src/cli/hsmm/`, mirroring existing `cli/`
      conventions (`BaseScript`, typed config, DI via constructor callbacks)
- [ ] Offline training script + model serialization (cron-scheduled like
      `signal-model-script.ts`)
- [ ] Live prediction hook into the live-stream pipeline (regime + expected
      remaining duration per minute)
- [ ] Frontend: regime badge + duration estimate on the live-ticks page

**Checkpoint**: architecture review before wiring into `live-stream-script.ts`.

## Phase 5 — Backtesting & monitoring

- [ ] Backtest regime-conditioned signals against the existing BB/RSI signal logic
- [ ] Track live regime-prediction accuracy (similar to the evaluation pattern in `plan.md`)

---

Tick off items as you go and bring derivations + diffs to each checkpoint.

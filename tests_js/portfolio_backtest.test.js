import test from "node:test";
import assert from "node:assert/strict";
import { compareFixedVsValuation, runPortfolioBacktest, simpleValuationMult } from "../js/portfolio-backtest.js";

test("simpleValuationMult drops at high PE", () => {
  assert.equal(simpleValuationMult(0.5), 1);
  assert.equal(simpleValuationMult(0.65), 0.5);
  assert.equal(simpleValuationMult(0.9), 0);
  assert.equal(simpleValuationMult(90), 0);
});

test("valuation leaves more cash than fixed when expensive", () => {
  // A rises then stays expensive (high pe); B flat cheap.
  const length = 120;
  const a = [];
  const b = [];
  const peA = [];
  const peB = [];
  for (let i = 0; i < length; i += 1) {
    a.push(100 + i * 0.5);
    b.push(100);
    peA.push(i < 20 ? 0.4 : 0.85);
    peB.push(0.3);
  }
  const { fixed, valuation } = compareFixedVsValuation({
    series: { A: a, B: b },
    peSeries: { A: peA, B: peB },
    weights: { A: 60, B: 40 },
    budgetPerPeriod: 2000,
    rebalanceEvery: 10,
    feeRate: 0.0003,
  });
  assert.ok(valuation.endingCashRatio > fixed.endingCashRatio + 0.02);
  assert.ok(Number.isFinite(fixed.annualReturn));
  assert.ok(Number.isFinite(valuation.maxDrawdown));
  assert.ok(fixed.volatility >= 0);
});

test("runPortfolioBacktest returns zeros for empty input", () => {
  const result = runPortfolioBacktest({});
  assert.equal(result.endingCashRatio, 1);
  assert.equal(result.mode, "fixed");
});

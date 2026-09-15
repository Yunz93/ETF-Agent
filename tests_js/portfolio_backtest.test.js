import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("runPortfolioBacktest marks missing history unavailable instead of reporting zero returns", () => {
  const result = runPortfolioBacktest({});
  assert.equal(result.endingCashRatio, 1);
  assert.equal(result.mode, "fixed");
  assert.equal(result.status, "insufficient_history");
  assert.equal(result.annualReturn, null);
});

test("flat prices keep time-weighted return and volatility at zero despite contributions", () => {
  const flat = Array.from({ length: 252 }, () => 100);
  const result = runPortfolioBacktest({
    series: { A: flat },
    weights: { A: 100 },
    budgetPerPeriod: 1000,
    rebalanceEvery: 20,
    feeRate: 0,
  });
  assert.equal(result.annualReturn, 0);
  assert.equal(result.maxDrawdown, 0);
  assert.equal(result.volatility, 0);
  assert.equal(result.endingEquity, 13_000);
  assert.equal(result.contributedCapital, 13_000);
  assert.equal(result.netProfit, 0);
  assert.equal(result.moneyWeightedReturn, null);
});

const fixture = JSON.parse(readFileSync(new URL("../tests/fixtures/portfolio_performance.json", import.meta.url), "utf8"));
for (const row of fixture.cases) {
  test(`shared Python/JS fixture: ${row.name}`, () => {
    const result = runPortfolioBacktest({
      series: { A: row.prices }, weights: { A: 100 }, dates: fixture.dates,
      periodsPerYear: 12, budgetPerPeriod: fixture.monthly_budget, rebalanceEvery: 1, feeRate: 0,
    });
    const close = (actual, expected, tolerance = 1e-8) => {
      assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
    };
    assert.equal(result.status, "ready");
    close(result.endingEquity, row.ending_value);
    close(result.contributedCapital, 30_000);
    close(result.netProfit, row.ending_value - 30_000);
    close(result.totalReturn, row.total_return);
    close(result.maxDrawdown, row.max_drawdown);
    close(result.volatility, row.volatility);
    const elapsedDays = (Date.parse(fixture.dates.at(-1)) - Date.parse(fixture.dates[0])) / 86400000;
    close(result.annualReturn, (1 + row.total_return) ** (365 / elapsedDays) - 1);
    const terminal = fixture.dates.reduce((sum, day) => sum + fixture.monthly_budget *
      (1 + result.moneyWeightedReturn) ** ((Date.parse(fixture.dates.at(-1)) - Date.parse(day)) / 86400000 / 365), 0);
    close(terminal, row.ending_value, 1e-6);
  });
}

test("flat prices with fees report a loss, including the first trade fee", () => {
  const result = runPortfolioBacktest({
    series: { A: [100, 100] }, weights: { A: 100 }, feeRate: 0.01,
    dates: ["2021-01-01", "2022-01-01"], rebalanceEvery: 20,
  });
  assert.ok(result.annualReturn < 0);
  assert.ok(result.maxDrawdown > 0);
  assert.ok(result.moneyWeightedReturn < 0);
  assert.ok(Math.abs(result.netProfit + result.fees) < 1e-8);
  assert.ok(Math.abs(result.annualReturn - (1 / 1.01 - 1)) < 1e-8);
  assert.equal(result.volatility, 0);
});

test("XIRR uses ACT/365 for a single initial investment", () => {
  const result = runPortfolioBacktest({
    series: { A: [100, 110] }, weights: { A: 100 }, feeRate: 0,
    dates: ["2021-01-01", "2022-01-01"],
  });
  assert.ok(Math.abs(result.moneyWeightedReturn - 0.1) < 1e-9);
  assert.ok(Math.abs(result.annualReturn - 0.1) < 1e-9);
});

test("missing assets, nonpositive prices and misaligned dates do not produce results", () => {
  const input = { series: { A: [100, 100] }, weights: { A: 100 } };
  for (const override of [
    { weights: { A: 50, B: 50 } },
    { series: { A: [100, 0] } },
    { series: { A: [100, NaN] } },
    { dates: ["2021-01-01"] },
    { dates: ["2021-01-01", "2021-01-01"] },
    { dates: ["2021-01-01", "2021-02-30"] },
    { periodsPerYear: 0 },
    { rebalanceEvery: 0 },
    { budgetPerPeriod: 0 },
    { feeRate: Infinity },
  ]) {
    const result = runPortfolioBacktest({ ...input, ...override });
    assert.equal(result.status, "insufficient_history");
    assert.equal(result.annualReturn, null);
  }
});

test("missing valuation history does not block the fixed benchmark", () => {
  const comparison = compareFixedVsValuation({ series: { A: [100, 110] }, weights: { A: 100 } });
  assert.equal(comparison.fixed.status, "ready");
  assert.equal(comparison.valuation.status, "insufficient_history");
  assert.equal(comparison.valuation.annualReturn, null);
});

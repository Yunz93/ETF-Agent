import test from "node:test";
import assert from "node:assert/strict";
import { REPLAY_SCHEMA, runStrategyReplay } from "../js/strategy-replay.js";

function fixture() {
  const days = [];
  for (let i = 0; i < 540; i++) {
    const d = new Date(Date.UTC(2020, 0, 2 + i));
    if ([0, 6].includes(d.getUTCDay())) continue;
    const date = d.toISOString().slice(0, 10);
    days.push({ date, trade_at: `${date}T14:50:00+08:00`, contribution: days.length % 21 === 0 ? 2000 : 0,
      assets: { "510300": { close: 10, cash_dividend: 0, share_factor: 1, source: "synthetic_test_only", quote: { price: 10,
        market_timestamp: `${date}T14:49:00+08:00`, product_quality: { premium_discount_pct: 0, bid_ask_spread_pct: 0.01 } },
        analysis: { point_in_time: true, observed_at: `${date}T07:00:00+08:00`, available_at: `${date}T08:00:00+08:00`, source: "synthetic_test_only", analyzed: true,
          assetClass: "equity_core", indexCode: "000300", pePct: 0.5, spreadPct: 0.5, biasPct: 0, grade: "C" } } } });
  }
  return { schema: REPLAY_SCHEMA, parameters_fixed_at: "2020-01-01T00:00:00+08:00", source: "synthetic_test_only",
    target_weights: { "510300": 100 }, price_basis: "raw_with_cash_dividends", dividends_complete: true, calendar_complete: true, corporate_actions_complete: true,
    slippage_bps: 0, initial: { as_of: "2020-01-01T15:00:00+08:00", cash: 0, holdings: { "510300": 0 }, prices: { "510300": 10 } },
    plan: { amount: 2000, strategy: "valuation", strategy_config: { sentiment: { enabled: false } },
      trading_cost: { lot_size: 1, min_commission: 0, commission_rate_pct: 0, max_fee_ratio_pct: 0 } }, days };
}

test("missing raw history never becomes a successful full strategy validation", () => {
  const r = runStrategyReplay({});
  assert.equal(r.status, "insufficient_history"); assert.deepEqual(r.strategies, []);
});
test("flat prices and contributions create no profits; chronological holdout is not prospective OOS", () => {
  const input = fixture(), original = JSON.stringify(input), r = runStrategyReplay(input);
  assert.equal(r.status, "ready", JSON.stringify(r.reasons));
  assert.equal(r.methodology.out_of_sample, false);
  assert.equal(r.methodology.chronological_holdout, true);
  for (const s of r.strategies) {
    assert.equal(s.annualized_return_pct, 0);
    assert.equal(s.holdout.annualized_return_pct, 0);
    assert.equal(s.final_equity, input.days.reduce((n, r) => n + r.contribution, 0));
    assert.ok(s.trades.length > 0);
  }
  assert.equal(JSON.stringify(input), original);
});
test("future signals, missing dividends, stale provenance and late fixed parameters refuse replay", () => {
  for (const mutate of [d => d.days[5].assets['510300'].analysis.available_at = d.days[5].trade_at,
    d => d.dividends_complete = false, d => d.days[5].assets['510300'].quote.product_quality.premium_discount_pct = null,
    d => d.days[5].assets['510300'].analysis.point_in_time = false,
    d => d.days[5].assets['510300'].analysis.observed_at = d.days[5].trade_at, d => d.parameters_fixed_at = d.days[10].trade_at,
    d => d.days[5].trade_at = `${d.days[5].date}T23:00:00+08:00`]) {
    const data = fixture(); mutate(data);
    assert.equal(runStrategyReplay(data).status, "insufficient_history");
  }
});
test("fees and slippage reduce wealth, remain cash-constrained, and affect holdout metrics", () => {
  const data = fixture(); data.slippage_bps = 20; data.plan.trading_cost.min_commission = 5;
  const r = runStrategyReplay(data); assert.equal(r.status, "ready", JSON.stringify(r.reasons));
  for (const s of r.strategies) {
    assert.ok(s.fees > 0); assert.ok(s.slippage_cost > 0); assert.ok(s.annualized_return_pct < 0);
    assert.ok(s.curve.every(r => r.cash >= -0.01));
    assert.ok(Math.abs(s.final_equity + s.fees + s.slippage_cost - data.days.reduce((n, r) => n + r.contribution, 0)) < .01);
  }
});
test("daily drawdown sees an intramonth crash that month-end prices miss", () => {
  const data = fixture(); data.initial.cash = 10000;
  const row = data.days[10]; row.assets['510300'].close = 5;
  const r = runStrategyReplay(data); assert.equal(r.status, "ready");
  assert.ok(r.strategies[0].max_drawdown_pct > 0);
});
test("premium blocks purchases and retains the actual cash rather than redistributing a blocked trade", () => {
  const data = fixture();
  for (const day of data.days) day.assets['510300'].quote.product_quality.premium_discount_pct = 10;
  const r = runStrategyReplay(data); assert.equal(r.status, "ready");
  assert.equal(r.strategies[0].trades.length, 0);
  assert.equal(r.strategies[0].average_cash_ratio_pct, 100);
});
test("cash dividends offset an ex-dividend price drop without double counting adjusted prices", () => {
  const data = fixture(); data.plan.amount = 0;
  data.initial.holdings['510300'] = 100;
  for (const day of data.days) { day.contribution = 0; day.assets['510300'].quote.price = 9; day.assets['510300'].close = 9; }
  data.days[0].assets['510300'].cash_dividend = 1;
  const r = runStrategyReplay(data); assert.equal(r.status, "ready");
  assert.equal(r.strategies[0].final_equity, 1000);
  assert.equal(r.strategies[0].annualized_return_pct, 0);
});

test("initial build uses absolute gap schedule independent of small recurring budget", () => {
  const data = fixture(); data.plan.amount = 1; data.plan.capital_base = 20000;
  data.plan.initial_target_pct = 60; data.plan.initial_months = 6; data.initial.cash = 20000;
  for (const day of data.days) day.contribution = 0;
  const r = runStrategyReplay(data); assert.equal(r.status, "ready", JSON.stringify(r.reasons));
  assert.equal(r.strategies[0].decisions[0].phase, "initial");
  assert.equal(r.strategies[0].trades[0].shares * r.strategies[0].trades[0].price, 2000);
  assert.ok(r.strategies[0].curve.every(d => d.cash >= 0));
});
test("split factors preserve wealth when raw prices change proportionally", () => {
  const data = fixture(); data.plan.amount = 0; data.initial.holdings['510300'] = 100;
  for (const day of data.days) { day.contribution = 0; day.assets['510300'].quote.price = 5; day.assets['510300'].close = 5; }
  data.days[0].assets['510300'].share_factor = 2;
  const r = runStrategyReplay(data); assert.equal(r.status, "ready");
  assert.equal(r.strategies[0].final_equity, 1000);
  assert.equal(r.strategies[0].annualized_return_pct, 0);
});
test("enabled sentiment requires original-time data for the markets actually used", () => {
  const data = fixture(); data.plan.strategy_config.sentiment.enabled = true;
  assert.equal(runStrategyReplay(data).status, "insufficient_history");
  for (const day of data.days) day.sentiment = { source: "synthetic", point_in_time: true,
    observed_at: `${day.date}T07:00:00+08:00`, available_at: `${day.date}T08:00:00+08:00`,
    by_market: { A: { score: 50, degraded: false } } };
  assert.equal(runStrategyReplay(data).status, "ready");
});

test("small adverse slippage keeps affordable board lots using the original strategic budget", () => {
  const data = fixture(); data.plan.trading_cost.lot_size = 100;
  data.plan.trading_cost.min_commission = 5;
  const withoutSlip = runStrategyReplay(data);
  data.slippage_bps = 20;
  const withSlip = runStrategyReplay(data);
  assert.equal(withSlip.status, "ready");
  for (let i = 0; i < withSlip.strategies.length; i++) {
    assert.equal(withSlip.strategies[i].trades.length, withoutSlip.strategies[i].trades.length);
    assert.ok(withSlip.strategies[i].trades.length > 0);
    assert.ok(withSlip.strategies[i].trades.every(t => t.shares % 100 === 0 && t.shares * t.price + t.fee <= 2000));
    assert.ok(withSlip.strategies[i].final_equity < withoutSlip.strategies[i].final_equity);
  }
});
test("replay refuses future initial-build state even when parameters claim an earlier fixed time", () => {
  for (const field of ["initial_build_started_at", "initial_build_completed_at"]) {
    for (const value of ["2030-01-01", "2030-01-01T00:00:00+08:00", "not a date"]) {
      const data = fixture(); data.plan[field] = value;
      const r = runStrategyReplay(data);
      assert.equal(r.status, "insufficient_history");
      assert.ok(r.reasons.some(r => r.includes(field)));
    }
  }
});
test("slippage re-sizing cannot cross the absolute initial target gap", () => {
  const data = fixture(); data.plan.capital_base = 10000; data.plan.initial_target_pct = 100;
  data.plan.initial_months = 1; data.initial.cash = 5000;
  data.initial.holdings['510300'] = 800; data.plan.amount = 0; data.slippage_bps = 20;
  data.plan.trading_cost.lot_size = 100; data.plan.trading_cost.min_commission = 5;
  for (const day of data.days) day.contribution = 0;
  const r = runStrategyReplay(data); assert.equal(r.status, "ready");
  assert.equal(r.strategies[0].decisions[0].phase, "initial");
  const trades = r.strategies[0].trades.filter(t => t.side === "buy");
  assert.ok(trades.length > 0);
  assert.ok(trades.reduce((n, t) => n + t.shares, 800) * 10 <= 10000);
  assert.ok(trades[0].shares * trades[0].price + trades[0].fee <= 2000);
});

test("unmodeled initial assets are rejected instead of disappearing from net worth", () => {
  for (const field of ["holdings", "prices"]) {
    const data = fixture(); data.initial[field]['513100'] = 10000;
    const r = runStrategyReplay(data); assert.equal(r.status, "insufficient_history");
    assert.ok(r.reasons.some(reason => reason.includes("目标集合以外")));
  }
});
test("weekend observations cannot schedule a Chinese ETF trade", () => {
  const data = fixture(); data.plan.day = 4;
  const row = JSON.parse(JSON.stringify(data.days[1]).replaceAll("2020-01-03", "2020-01-04"));
  data.days.splice(2, 0, row);
  const r = runStrategyReplay(data); assert.equal(r.status, "insufficient_history");
  assert.ok(r.reasons.some(reason => reason.includes("周末")));
});

test("unfunded plans and stale initial valuations cannot manufacture a performance interval", () => {
  const unfunded = fixture(); for (const day of unfunded.days) day.contribution = 0;
  assert.equal(runStrategyReplay(unfunded).status, "insufficient_history");
  const stale = fixture(); stale.initial.as_of = "2010-01-01T15:00:00+08:00";
  assert.equal(runStrategyReplay(stale).status, "insufficient_history");
});

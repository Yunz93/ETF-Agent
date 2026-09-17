import test from "node:test";
import assert from "node:assert/strict";
import { isAnalysisFresh, isAnalysisUsable, fetchAnalysis } from "../js/analysis-cache.js";
import { buildSignalSnapshot, getCurrentSignalSnapshot } from "../js/signal-snapshot.js";
import { allocatePoolBudget } from "../js/strategy-allocate.js";
import { buildTradePlan } from "../js/trade-plan.js";
import { canSubmitWithOverride, evaluateExecutionPolicy } from "../js/execution-policy.js";
import { sellSuggestionForSymbol } from "../js/execution-drafts.js";
import { dcaMultiplier } from "../js/strategy-multipliers.js";
import { state } from "../js/state.js";
import { getPeriodAdvice } from "../js/period-advice.js";
import { currentPoolAllocationResult, buildPoolHoldingsForAllocation } from "../js/pool-alloc.js";
import { normalizePlan } from "../js/workspace_model.js";

const NOW = new Date("2026-09-16T02:00:00Z");
const COST = { min_commission: 0, commission_rate_pct: 0, max_fee_ratio_pct: 1, lot_size: 100 };
const holding = (patch = {}) => ({ symbol: "563360", name: "A500", targetWeight: 100, actualWeight: null,
  marketValue: 0, shares: 0, assetClass: "equity_core", indexCode: "000510", pePct: 0.79,
  grade: "D", analyzed: true, ...patch });
const quote = (age = 0) => ({ price: 1, market_timestamp: new Date(NOW.getTime() - age * 60_000).toISOString(),
  product_quality: { premium_discount_pct: 0, bid_ask_spread_pct: 0.05 } });
const plan = (patch = {}) => normalizePlan({ amount: 20000, strategy: "valuation", cadence: "monthly",
  trading_cost: COST, strategy_config: { sentiment: { enabled: false } }, ...patch });
const payload = (patch = {}) => ({ supported: true, asset_class: "equity_core", updated_at: NOW.toISOString(),
  valuation: { pe: 15, pe_percentile_10y: 0.5 }, technicals: { bias_pct: 0, rsi14: 50 },
  score: { status: "diagnostic_only", total: 60, grade: "C", missing_required: [] }, ...patch });

// Tests span snapshot construction, serialization and allocation rather than checking a helper in isolation.
test("hysteresis-selected PE band controls actual multiplier after workspace round trip", () => {
  const settings = plan();
  const first = buildSignalSnapshot({ plan: settings, period: "2026-08-01", holdings: [holding()], now: NOW });
  const second = buildSignalSnapshot({ plan: settings, period: "2026-09-01", previousSnapshot: first,
    holdings: [holding({ pePct: 0.81 })], now: NOW });
  const restored = normalizePlan({ ...settings, signal_snapshots: { "2026-09-01": second } });
  const frozen = getCurrentSignalSnapshot(restored, "2026-09-01").holdings;
  assert.equal(frozen["563360"].band_index, 3);
  assert.equal(frozen["563360"].effective_mult, 0.5);
  const result = allocatePoolBudget({ budget: 20000, holdings: [holding({ pePct: 0.95 })],
    strategy: settings.strategy, strategyConfig: settings.strategy_config, strategyFrozenBySymbol: frozen });
  assert.equal(result.allocations[0].mult, 0.5);
  assert.equal(result.deployTotal, 10000);
  assert.equal(result.cashKeep, 10000);
});

test("live PE and sentiment changes cannot rewrite frozen amount or decision multiplier", () => {
  const settings = plan();
  const snap = buildSignalSnapshot({ plan: settings, period: "2026-09-01", holdings: [holding()], now: NOW });
  const result = buildTradePlan({ plan: settings, holdings: [holding({ pePct: 0.99 })], quotes: { "563360": quote() },
    now: NOW, strategyFrozenBySymbol: snap.holdings, signalSnapshotId: snap.id,
    sentimentByMarket: { A: { score: 1, mult: 1.3 } } });
  const draft = result.buyDrafts[0];
  assert.equal(draft.suggested_amount, 10000);
  assert.equal(draft.decision_snapshot.effective_mult, 0.5);
  assert.equal(draft.decision_snapshot.signal_snapshot_id, snap.id);
  assert.equal(draft.readiness_status, "ready");
});

test("unknown requested period does not silently reuse an earlier snapshot", () => {
  assert.equal(getCurrentSignalSnapshot({ signal_snapshots: { "2026-08-01": { id: "old" } } }, "2026-09-01"), null);
});

test("missing PE stays missing after snapshot serialization and cannot gain sentiment uplift", () => {
  const settings = plan({ strategy_config: { sentiment: { enabled: true } } });
  const snap = buildSignalSnapshot({ plan: settings, period: "2026-09-01", holdings: [holding({ pePct: null, analyzed: false })],
    now: NOW, sentimentByMarket: { A: { score: 1, degraded: false } } });
  const saved = normalizePlan({ ...settings, signal_snapshots: { "2026-09-01": snap } }).signal_snapshots["2026-09-01"].holdings["563360"];
  assert.equal(saved.pe_pct, null);
  assert.equal(saved.spread_pct, null);
  assert.equal(saved.band_index, null);
  assert.equal(saved.analysis_usable, false);
  assert.ok(saved.effective_mult <= 1);
});

test("expired, future, or undated prices cannot be manually promoted from preview", () => {
  for (const candidate of [quote(20), quote(-10), { ...quote(), market_timestamp: null }]) {
    const policy = evaluateExecutionPolicy({ quote: candidate, now: NOW, analysisUsable: true });
    assert.equal(policy.status, "preview");
    assert.equal(policy.canOverride, false);
    assert.equal(canSubmitWithOverride({ status: policy.status, overrideReason: "确认承担风险" }).ok, false);
  }
});

test("expired quotes yield waiting cash and zero executable draft cash", () => {
  const result = buildTradePlan({ plan: plan({ strategy: "fixed" }), holdings: [holding()], quotes: { "563360": quote(20) }, now: NOW });
  assert.equal(result.buyDrafts[0].readiness_status, "preview");
  assert.equal(result.buyDrafts[0].total_cash, 0);
  assert.equal(result.summary.readyBuyCount, 0);
});

test("backend diagnostic payload is usable while explicit missing factors are rejected", () => {
  assert.equal(isAnalysisUsable(payload()), true);
  assert.equal(isAnalysisUsable(payload({ score: { status: "insufficient_data", total: null, grade: null, missing_required: ["valuation"] } })), false);
  assert.equal(isAnalysisUsable(payload({ asset_class: "dividend", spread: { value: null } })), false);
  assert.equal(isAnalysisUsable(payload({ asset_class: "dividend", spread: { value: 0 } })), true);
});

test("analysis timestamps from the future are not fresh", () => {
  assert.equal(isAnalysisFresh(payload({ updated_at: new Date(NOW.getTime() + 60 * 60_000).toISOString() }), NOW.getTime()), false);
});

test("rebalance must not buy an ETF whose frozen per-ETF strategy says zero", () => {
  const settings = plan({ strategy: "rebalance", strategy_overrides: { "563360": "valuation" } });
  const holdings = [holding({ targetWeight: 50, actualWeight: 50, pePct: 0.95 }),
    holding({ symbol: "510300", indexCode: "000300", targetWeight: 50, actualWeight: 50, pePct: 0.5 })];
  const snap = buildSignalSnapshot({ plan: settings, period: "2026-09-01", holdings, now: NOW });
  assert.equal(snap.holdings["563360"].effective_mult, 0);
  const result = buildTradePlan({ plan: settings, holdings, quotes: { "563360": quote(), "510300": quote() }, now: NOW,
    strategyFrozenBySymbol: snap.holdings, signalSnapshotId: snap.id });
  assert.equal(result.buyDrafts.some(row => row.symbol === "563360"), false);
});


test("a single ETF at 100 percent target retains room for recurring contributions", () => {
  const result = allocatePoolBudget({ budget: 20000, strategy: "fixed", holdings: [holding({ marketValue: 10000, shares: 10000, actualWeight: 100 })] });
  assert.equal(result.deployTotal, 20000);
});


test("ETF advice, pool display and trade plan use one frozen strategy despite live changes", () => {
  const previous = { plan: state.plan, etfs: state.etfs, analysisCache: state.analysisCache, quotes: state.quotesBySymbol };
  const settings = plan();
  const snap = buildSignalSnapshot({ plan: settings, period: "2026-09-01", holdings: [holding()], now: NOW });
  const active = { ...settings, signal_snapshots: { "2026-09-01": snap } };
  try {
    state.plan = active;
    state.etfs = [{ symbol: "563360", shares: 0, target_weight: 100 }];
    state.analysisCache = { "563360": payload({ valuation: { pe: 20, pe_percentile_10y: 0.99 } }) };
    state.quotesBySymbol = { "563360": quote() };
    const advice = getPeriodAdvice({ symbol: "563360", now: NOW });
    const allocation = currentPoolAllocationResult({ now: NOW });
    const trade = buildTradePlan({ plan: settings, holdings: buildPoolHoldingsForAllocation({ now: NOW }),
      quotes: state.quotesBySymbol, now: NOW, strategyFrozenBySymbol: snap.holdings, signalSnapshotId: snap.id });
    assert.equal(advice.amount, trade.buyDrafts[0].suggested_amount);
    assert.equal(advice.amount, allocation.allocations[0].amount);
    assert.equal(advice.mult, 0.5);
    assert.equal(advice.sentimentMult, 1);
    assert.equal(advice.canAdd, true);
    state.quotesBySymbol = { "563360": quote(20) };
    const stale = getPeriodAdvice({ symbol: "563360", now: NOW });
    assert.equal(stale.amount, advice.amount);
    assert.equal(stale.readiness.status, "preview");
    assert.equal(stale.canAdd, false);
  } finally {
    state.plan = previous.plan; state.etfs = previous.etfs;
    state.analysisCache = previous.analysisCache; state.quotesBySymbol = previous.quotes;
  }
});

test("a new ETF missing from this period snapshot awaits reevaluation", () => {
  const settings = plan({ strategy: "fixed" });
  const frozen = buildSignalSnapshot({ plan: settings, period: "2026-09-01", holdings: [holding()], now: NOW }).holdings;
  const result = allocatePoolBudget({ budget: 20000, strategy: "fixed", strategyFrozenBySymbol: frozen,
    holdings: [holding({ targetWeight: 50 }), holding({ symbol: "510300", targetWeight: 50 })] });
  assert.equal(result.allocations.some(row => row.symbol === "510300"), false);
  assert.match(result.skipped.find(row => row.symbol === "510300").band, /快照未包含/);
});

test("new degraded lite data replaces an expired full diagnostic", async () => {
  const previous = state.analysisCache;
  const originalFetch = globalThis.fetch;
  state.analysisCache = { "563360": payload({ updated_at: "2020-01-01T00:00:00Z" }) };
  globalThis.fetch = async () => ({ json: async () => payload({ score: { status: "insufficient_data", total: null, missing_required: ["valuation"] } }) });
  try {
    const result = await fetchAnalysis("563360", { lite: true, force: true });
    assert.equal(result.score.status, "insufficient_data");
    assert.equal(isAnalysisUsable(state.analysisCache["563360"]), false);
  } finally { globalThis.fetch = originalFetch; state.analysisCache = previous; }
});

test("expired analysis cannot seed a new allocation signal", () => {
  const previous = { etfs: state.etfs, analysisCache: state.analysisCache, quotes: state.quotesBySymbol };
  try {
    state.etfs = [{ symbol: "563360", shares: 0, target_weight: 100 }];
    state.quotesBySymbol = { "563360": quote() };
    state.analysisCache = { "563360": payload({ updated_at: "2020-01-01T00:00:00Z" }) };
    const item = buildPoolHoldingsForAllocation({ now: NOW })[0];
    assert.equal(item.analyzed, false);
    assert.equal(item.pePct, null);
  } finally { state.etfs = previous.etfs; state.analysisCache = previous.analysisCache; state.quotesBySymbol = previous.quotes; }
});


test("dividend spread alone cannot raise investment without required PE", () => {
  for (const pePct of [null, undefined, "", false]) {
    const result = dcaMultiplier({ strategy: "valuation", assetClass: "dividend", pePct, spreadPct: 0.99, grade: "A" });
    assert.equal(result.mult, 1);
    assert.match(result.band, /数据不足/);
    assert.doesNotMatch(result.hint, /PE 分位≤/);
  }
});

test("new holdings remain in the sell denominator but cannot sell without a frozen signal", () => {
  const settings = plan();
  const holdings = [
    holding({ targetWeight: 40, marketValue: 80000, shares: 8000, pePct: 0.95, grade: "E" }),
    holding({ symbol: "510300", targetWeight: 40, marketValue: 10000, shares: 1000 }),
    holding({ symbol: "510500", targetWeight: 20, marketValue: 10000, shares: 1000 }),
  ];
  const snap = buildSignalSnapshot({ plan: settings, period: "2026-09-01", holdings: holdings.slice(0, 2), now: NOW });
  const quotes = Object.fromEntries(holdings.map(h => [h.symbol, { ...quote(), price: 10 }]));
  const result = buildTradePlan({ plan: settings, phase: "recurring", holdings, quotes,
    poolAllocation: { allocations: [], budget: 0 },
    strategyFrozenBySymbol: snap.holdings, signalSnapshotId: snap.id, now: NOW });
  const sell = result.sellDrafts.find(row => row.symbol === "563360");
  assert.equal(sell.shares, 6300);
  assert.ok((80000 - sell.suggested_amount) / (100000 - sell.suggested_amount) >= 0.45);
  assert.ok(result.sellSuggestions.every(row => row.symbol !== "510500"));
});

test("sell checklist and ETF detail share frozen valuation with live holdings and quotes", () => {
  const previous = { plan: state.plan, etfs: state.etfs, analysisCache: state.analysisCache,
    quotes: state.quotesBySymbol, executionDrafts: state.executionDrafts };
  const settings = plan();
  const holdings = [holding({ targetWeight: 20, actualWeight: 40, marketValue: 40000, shares: 40000, pePct: 0.95, grade: "E" }),
    holding({ symbol: "510300", indexCode: "000300", targetWeight: 80, actualWeight: 60, marketValue: 60000, shares: 15000, pePct: 0.99, grade: "E" })];
  const snap = buildSignalSnapshot({ plan: settings, period: "2026-09-01", holdings, now: NOW });
  try {
    state.plan = { ...settings, signal_snapshots: { "2026-09-01": snap } };
    state.etfs = [{ symbol: "563360", target_weight: 20, shares: 40000 }, { symbol: "510300", target_weight: 80, shares: 15000 }];
    state.analysisCache = { "563360": payload({ valuation: { pe: 12, pe_percentile_10y: 0.1 }, score: { status: "diagnostic_only", grade: "A", total: 90 } }),
      "510300": payload({ valuation: { pe: 20, pe_percentile_10y: 0.99 }, score: { status: "diagnostic_only", grade: "E", total: 20 } }) };
    state.quotesBySymbol = { "563360": { ...quote(), price: 1.25 }, "510300": { ...quote(), price: 4 } };
    state.executionDrafts = [];
    const result = buildTradePlan({ plan: settings, holdings: buildPoolHoldingsForAllocation({ now: NOW }),
      quotes: state.quotesBySymbol, now: NOW, strategyFrozenBySymbol: snap.holdings, signalSnapshotId: snap.id });
    const sell = result.sellDrafts.find(row => row.symbol === "563360");
    assert.ok(sell, "live cheap PE must not rewrite the frozen rich valuation");
    assert.equal(sell.price, 1.25);
    assert.equal(sell.decision_snapshot.current_market_value, 50000);
    const advice = sellSuggestionForSymbol("563360", { now: NOW });
    assert.equal(advice.shares, sell.shares);
    assert.equal(advice.suggested_amount, sell.suggested_amount);
    assert.equal(advice.signalSnapshotId, snap.id);
    assert.equal(advice.readinessStatus, "ready");
    state.quotesBySymbol["563360"] = { ...quote(20), price: 1.25 };
    const stale = sellSuggestionForSymbol("563360", { now: NOW });
    assert.equal(stale.shares, sell.shares);
    assert.equal(stale.readinessStatus, "preview");
  } finally {
    state.plan = previous.plan; state.etfs = previous.etfs; state.analysisCache = previous.analysisCache;
    state.quotesBySymbol = previous.quotes; state.executionDrafts = previous.executionDrafts;
  }
});

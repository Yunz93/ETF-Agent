import test from "node:test";
import assert from "node:assert/strict";
import { simulationWeights, simulationRequest, comparisonText } from "../js/strategy-simulation.js";

const etfs = [{ symbol: "510300", target_weight: 40, shares: 100 }, { symbol: "513500", target_weight: 60, shares: 200 }];
const quotes = { "510300": { price: 10 }, "513500": { price: 5 } };

test("one portfolio can use target or current market-value composition without modifying holdings", () => {
  const before = JSON.stringify(etfs);
  assert.deepEqual(simulationWeights(etfs, quotes, "target"), { "510300": 40, "513500": 60 });
  assert.deepEqual(simulationWeights(etfs, quotes, "holdings"), { "510300": 50, "513500": 50 });
  assert.equal(JSON.stringify(etfs), before);
});
test("missing prices and invalid weights cannot silently drop a holding", () => {
  assert.throws(() => simulationWeights(etfs, {}, "holdings"), /缺少有效行情/);
  assert.throws(() => simulationWeights([], {}, "holdings"), /没有持仓/);
  assert.throws(() => simulationWeights([etfs[0]], quotes, "target"), /100%/);
});
test("request includes fees and all experiment settings but no live buy records", () => {
  const plan = { trading_cost: { min_commission: 8, max_fee_ratio_pct: 0 } };
  const values = { basis: "holdings", cadence: "weekly", budget: "2000", dip_pct: "3", years: "5", initial_cash: "10000" };
  const result = simulationRequest(etfs, quotes, plan, values);
  assert.equal(result.budget, 2000);
  assert.equal(result.dip_pct, 3);
  assert.equal(result.initial_cash, 10000);
  assert.equal(result.trading_cost.min_commission, 8);
  assert.equal(result.trading_cost.max_fee_ratio_pct, 0);
  assert.equal(result.cadence, "weekly");
  assert.equal(result.shares, undefined);
  assert.notDeepEqual(result, simulationRequest(etfs, quotes, plan, { ...values, dip_pct: "5" }));
});
test("comparison describes this historical period and handles tied and negative results", () => {
  assert.match(comparisonText({ net_profit: -200 }, { net_profit: -100 }), /这段历史.*逢低加仓多赚 ¥100/);
  assert.match(comparisonText({ net_profit: 0 }, { net_profit: 0 }), /相同/);
});

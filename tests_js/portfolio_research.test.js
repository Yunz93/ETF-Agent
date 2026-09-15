import test from "node:test";
import assert from "node:assert/strict";
import { researchRequest, researchResultIsStale } from "../js/portfolio-research.js";

const etfs = [{ symbol: "518880", target_weight: 40, shares: 90 }, { symbol: "510300", target_weight: 60, shares: 10 }];
const plan = { amount: 1000, cadence: "weekly", strategy: "valuation", investment_goal: { horizon_years: 10, annual_return_target_pct: 10 }, trading_cost: { min_commission: 0 } };

test("research captures explicit monthly budget without changing the real plan or leaking holdings", () => {
  const before = JSON.stringify({ etfs, plan });
  const request = researchRequest(etfs, plan, 5000);
  assert.equal(request.monthly_budget, 5000);
  assert.equal(request.trading_cost.min_commission, 0);
  assert.deepEqual(request.target_weights, { "510300": 60, "518880": 40 });
  assert.equal(JSON.stringify({ etfs, plan }), before);
  assert.ok(!JSON.stringify(request).includes("shares"));
  assert.ok(!JSON.stringify(request).includes("weekly"));
});

test("stale result tracks changes in targets goals budget and costs but not quote refreshes", () => {
  const request = researchRequest(etfs, plan, 5000);
  assert.equal(researchResultIsStale(request, [...etfs].reverse(), plan, "5000"), false);
  assert.equal(researchResultIsStale(request, etfs.map(row => ({ ...row, shares: 200 })), plan, 5000), false);
  assert.equal(researchResultIsStale(request, etfs, plan, 6000), true);
  assert.equal(researchResultIsStale(request, etfs, { ...plan, trading_cost: { min_commission: 5 } }, 5000), true);
  assert.equal(researchResultIsStale(request, etfs, { ...plan, investment_goal: { horizon_years: 5 } }, 5000), true);
  assert.equal(researchResultIsStale(request, [{ ...etfs[0], target_weight: 50 }, etfs[1]], plan, 5000), true);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessPortfolioGoal, classifyExposure, normalizeInvestmentGoal } from "../js/portfolio-goal.js";
import { chooseWorkspaceSource, normalizePlan } from "../js/workspace_model.js";
import { allocatePoolBudget, allocationForSymbol } from "../js/strategy.js";

test("goal normalization agrees with Python and preserves unset vs zero", () => {
  const fixture = JSON.parse(readFileSync(new URL("../tests/fixtures/investment_goal.json", import.meta.url), "utf8"));
  for (const row of fixture) assert.deepEqual(normalizeInvestmentGoal(row.input), row.expected);
});

const etfs = [
  { symbol: "A", name: "标普宽基", shares: 60, target_weight: 40 },
  { symbol: "B", name: "标普另一只", shares: 20, target_weight: 20 },
  { symbol: "C", name: "黄金ETF", shares: 20, target_weight: 40 },
];
const registry = { A: { index_code: "SPX", index_name: "标普500" }, B: { index_code: "SPX", index_name: "标普500" } };
const quotes = { A: { price: 10 }, B: { price: 10 }, C: { price: 10 } };
const goal = { annual_return_target_pct: 10, horizon_years: 10, max_drawdown_pct: 20, single_index_warn_pct: 50 };

test("same-index holdings combine for concentration and stress is not a forecast", () => {
  const result = assessPortfolioGoal({ etfs, quotes, registry, goal });
  assert.equal(result.indices[0].current, 80);
  assert.equal(result.indices[0].target, 60);
  assert.deepEqual(result.indices[0].symbols, ["A", "B"]);
  assert.equal(result.currentStress, 38);
  assert.equal(result.targetStress, 31);
  assert.equal(result.status, "review");
  assert.ok(result.warnings.some((message) => message.includes("集中提示线")));
  assert.ok(result.warnings.some((message) => message.includes("承受值")));
});

test("dividend stocks remain equity and unknown exposure is not treated as safe", () => {
  assert.equal(classifyExposure({ name: "红利" }, { index_code: "H30269" }).asset, "equity");
  assert.equal(classifyExposure({ name: "黄金ETF" }).region, "non_equity");
  const result = assessPortfolioGoal({ etfs: [{ symbol: "X", shares: 1, target_weight: 100 }], quotes: { X: { price: 10 } }, goal });
  assert.equal(result.currentStress, null);
  assert.equal(result.targetStress, null);
  assert.equal(result.assets.find((row) => row.id === "unknown").current, 100);
});

test("current stress still warns when target stress is within tolerance", () => {
  const result = assessPortfolioGoal({ etfs, quotes, registry, goal: { ...goal, max_drawdown_pct: 35 } });
  assert.ok(result.warnings.some((message) => message.startsWith("当前配置在假设情景")));
  assert.ok(!result.warnings.some((message) => message.startsWith("目标配置在假设情景")));
});

test("missing quotes invalidate all current percentages while keeping target checks", () => {
  const result = assessPortfolioGoal({ etfs, quotes: { A: quotes.A }, registry, goal });
  assert.equal(result.currentAvailable, false);
  assert.ok(result.assets.every((row) => row.current === null));
  assert.equal(result.currentStress, null);
  assert.equal(result.targetStress, 31);
});

test("invalid target sum and short-horizon liquidity produce explicit review messages", () => {
  const result = assessPortfolioGoal({ etfs: [etfs[0]], quotes, registry,
    goal: { ...goal, horizon_years: 3, liquidity_need: "within_3_years" } });
  assert.equal(result.targetStress, null);
  assert.ok(result.warnings.some((message) => message.includes("合计")));
  assert.ok(result.warnings.some((message) => message.includes("近期用款")));
  assert.ok(result.warnings.some((message) => message.includes("不足十年")));
});

test("saved goal survives normalization and reload before ETFs are added", () => {
  const plan = normalizePlan({ investment_goal: goal, execution_policy: { premium_block_pct: 4 }, signal_snapshots: {} });
  assert.deepEqual(plan.investment_goal, normalizeInvestmentGoal(goal));
  assert.equal(plan.execution_policy.premium_block_pct, 4);
  const remote = { etfs: [], plan, updated_at: "2026-09-14T00:00:00Z" };
  assert.equal(chooseWorkspaceSource(remote, null).source, "server");
  assert.equal(chooseWorkspaceSource({ etfs: [] }, remote).source, "local-cache");
});

test("cash-flow rebalance accounts for large contributions before deciding overweight", () => {
  const result = allocatePoolBudget({ budget: 10000, strategy: "rebalance", holdings: [
    { symbol: "A", targetWeight: 50, actualWeight: 60, marketValue: 6000 },
    { symbol: "B", targetWeight: 50, actualWeight: 40, marketValue: 4000 },
  ], cashReserve: 5000 });
  assert.equal(allocationForSymbol(result, "A").amount, 4000);
  assert.equal(allocationForSymbol(result, "B").amount, 6000);
  assert.equal(result.deployTotal, 10000);
  assert.equal(result.cashRelease, 0);
});

test("cash-flow rebalance preserves cash on incomplete values or target weights", () => {
  for (const holding of [
    { symbol: "A", targetWeight: 100, shares: 100, marketValue: null, quoteMissing: true },
    { symbol: "A", targetWeight: 50, marketValue: 1000 },
  ]) {
    const result = allocatePoolBudget({ budget: 1000, strategy: "rebalance", holdings: [holding] });
    assert.equal(result.deployTotal, 0);
    assert.equal(result.cashKeep, 1000);
  }
});

test("rebalance initial build respects absolute gaps despite relative overweight", () => {
  const result = allocatePoolBudget({ budget: 10000, strategy: "rebalance", preferTargetGap: true, buildTargetAmount: 40000,
    holdings: [
      { symbol: "A", targetWeight: 50, actualWeight: 80, marketValue: 8000 },
      { symbol: "B", targetWeight: 50, actualWeight: 20, marketValue: 2000 },
    ] });
  assert.ok(allocationForSymbol(result, "A").amount > 0);
  assert.ok(allocationForSymbol(result, "A").amount <= 12000);
  assert.equal(result.deployTotal, 10000);
});

test("empty holdings have no fabricated current risk or completed goal", () => {
  const result = assessPortfolioGoal();
  assert.equal(result.status, "incomplete");
  assert.equal(result.currentStress, null);
});

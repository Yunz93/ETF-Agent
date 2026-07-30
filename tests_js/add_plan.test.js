import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_ADD_PLAN_LEVELS_BY_CLASS,
  normalizeAddPlanConfig,
  buildAddPlan,
} from "../js/add-plan.js";

test("asset class defaults: growth 5/10, core 3/5, commodity/bond null", () => {
  assert.deepEqual(
    DEFAULT_ADD_PLAN_LEVELS_BY_CLASS.equity_growth.map((row) => row.drawdown_pct),
    [5, 10],
  );
  assert.deepEqual(
    DEFAULT_ADD_PLAN_LEVELS_BY_CLASS.equity_core.map((row) => row.drawdown_pct),
    [3, 5],
  );
  assert.deepEqual(
    DEFAULT_ADD_PLAN_LEVELS_BY_CLASS.dividend.map((row) => row.drawdown_pct),
    [3, 5],
  );
  assert.equal(DEFAULT_ADD_PLAN_LEVELS_BY_CLASS.commodity, null);
  assert.equal(DEFAULT_ADD_PLAN_LEVELS_BY_CLASS.bond, null);
});

test("commodity/bond skip tiers unless custom levels provided", () => {
  const skipped = buildAddPlan({
    price: 4.2,
    amount: 2000,
    assetClass: "commodity",
    mult: 1,
  });
  assert.equal(skipped.applicable, false);
  assert.match(skipped.reason, /商品/);

  const bond = buildAddPlan({
    price: 100,
    amount: 2000,
    assetClass: "bond",
    mult: 1,
  });
  assert.equal(bond.applicable, false);
  assert.match(bond.reason, /债券/);

  const custom = buildAddPlan({
    price: 4.2,
    amount: 2000,
    assetClass: "commodity",
    mult: 1,
    config: {
      levels: [
        { drawdown_pct: 4, ratio: 0.5 },
        { drawdown_pct: 8, ratio: 0.5 },
      ],
    },
  });
  assert.equal(custom.applicable, true);
  assert.equal(custom.levels.length, 2);
  assert.ok(Math.abs(custom.levels[0].trigger - 4.2 * (1 - 0.04)) < 1e-9);
});

test("valuation depth scaling: undervalued narrows, elevated widens", () => {
  const narrow = buildAddPlan({
    price: 1,
    amount: 2000,
    assetClass: "equity_core",
    mult: 1.5,
  });
  assert.equal(narrow.depthScale, 0.6);
  assert.equal(narrow.depthLabel, "低估收窄");
  assert.ok(Math.abs(narrow.levels[0].drawdownPct - 1.8) < 1e-9);
  assert.ok(Math.abs(narrow.levels[0].trigger - (1 - 0.018)) < 1e-9);

  const wide = buildAddPlan({
    price: 1,
    amount: 2000,
    assetClass: "equity_core",
    mult: 0.5,
  });
  assert.equal(wide.depthScale, 1.5);
  assert.equal(wide.depthLabel, "偏高放宽");
  assert.ok(Math.abs(wide.levels[0].drawdownPct - 4.5) < 1e-9);

  const standard = buildAddPlan({
    price: 1,
    amount: 2000,
    assetClass: "equity_core",
    mult: 1,
  });
  assert.equal(standard.depthScale, 1);
  assert.equal(standard.depthLabel, "标准");
});

test("anchor price/cost with cost missing fallback", () => {
  const byPrice = buildAddPlan({
    price: 1.2,
    cost: 1.0,
    amount: 2000,
    assetClass: "equity_core",
    mult: 1,
    config: { anchor: "price" },
  });
  assert.equal(byPrice.anchor, "price");
  assert.equal(byPrice.anchorPrice, 1.2);

  const byCost = buildAddPlan({
    price: 1.2,
    cost: 1.0,
    amount: 2000,
    assetClass: "equity_core",
    mult: 1,
    config: { anchor: "cost" },
  });
  assert.equal(byCost.anchor, "cost");
  assert.equal(byCost.anchorPrice, 1.0);

  const fallback = buildAddPlan({
    price: 1.198,
    cost: null,
    amount: 2000,
    assetClass: "equity_core",
    mult: 1,
    config: { anchor: "cost" },
  });
  assert.equal(fallback.anchor, "price");
  assert.equal(fallback.anchorPrice, 1.198);
});

test("normalizeAddPlanConfig clamps, sorts, truncates and normalizes ratios", () => {
  const empty = normalizeAddPlanConfig(null);
  assert.deepEqual(empty, { enabled: true, anchor: "price", preset: "auto", levels: null });

  const normalized = normalizeAddPlanConfig({
    enabled: true,
    anchor: "cost",
    levels: [
      { drawdown_pct: 12, ratio: 1 },
      { drawdown_pct: 0.1, ratio: 1 },
      { drawdown_pct: 40, ratio: 2 },
      { drawdown_pct: 8, ratio: 1 },
      { drawdown_pct: 20, ratio: 1 },
    ],
  });
  assert.equal(normalized.levels.length, 4);
  assert.deepEqual(
    normalized.levels.map((row) => row.drawdown_pct),
    [0.5, 8, 12, 30],
  );
  const ratioSum = normalized.levels.reduce((sum, row) => sum + row.ratio, 0);
  assert.ok(Math.abs(ratioSum - 1) < 1e-9);
  assert.ok(Math.abs(normalized.levels[2].ratio - 0.2) < 1e-9);

  assert.equal(normalizeAddPlanConfig({ levels: [{ drawdown_pct: 3, ratio: 0 }] }).levels, null);
  assert.equal(normalizeAddPlanConfig({ anchor: "nope" }).anchor, "price");
  assert.equal(normalizeAddPlanConfig({ enabled: false }).enabled, false);
});

test("triggered when price is at or below trigger", () => {
  const plan = buildAddPlan({
    price: 0.97,
    amount: 5000,
    assetClass: "equity_core",
    mult: 1,
    config: { anchor: "price" },
  });
  // 锚 0.97 时第一档触发价 = 0.97 * 0.97，现价等于锚点，尚未触发
  assert.equal(plan.levels[0].triggered, false);

  const hit = buildAddPlan({
    price: 0.96,
    cost: 1,
    amount: 5000,
    assetClass: "equity_core",
    mult: 1,
    config: { anchor: "cost" },
  });
  // 成本锚 1 → 第一档 0.97，现价 0.96 已触发；第二档 0.95 未触发
  assert.equal(hit.levels[0].triggered, true);
  assert.equal(hit.levels[1].triggered, false);
});

test("unknown/null asset class uses equity_core defaults", () => {
  const unknown = buildAddPlan({
    price: 1,
    amount: 1000,
    assetClass: null,
    mult: 1,
  });
  assert.equal(unknown.applicable, true);
  assert.deepEqual(
    unknown.levels.map((row) => row.drawdownPct),
    [3, 5],
  );

  const legacy = buildAddPlan({
    price: 1,
    amount: 1000,
    assetClass: "something_else",
    mult: 1,
  });
  assert.deepEqual(
    legacy.levels.map((row) => row.drawdownPct),
    [3, 5],
  );
});

test("presets: steady/deep use fixed ladders without valuation scaling", () => {
  // 稳健两档：−3/−5 固定，不随估值缩放
  const steady = buildAddPlan({
    price: 1,
    amount: 2000,
    assetClass: "equity_growth",
    mult: 1.5,
    config: { preset: "steady" },
  });
  assert.equal(steady.preset, "steady");
  assert.equal(steady.presetLabel, "稳健两档");
  assert.equal(steady.depthScale, 1);
  assert.equal(steady.depthLabel, "固定档距");
  assert.deepEqual(steady.levels.map((row) => row.drawdownPct), [3, 5]);

  // 深回调两档：−5/−10；显式预设时商品类也分档
  const deep = buildAddPlan({
    price: 4.2,
    amount: 2000,
    assetClass: "commodity",
    mult: 0.5,
    config: { preset: "deep" },
  });
  assert.equal(deep.applicable, true);
  assert.deepEqual(deep.levels.map((row) => row.drawdownPct), [5, 10]);
});

test("preset normalization: legacy levels infer custom, custom without levels falls back to auto", () => {
  const inferred = normalizeAddPlanConfig({ levels: [{ drawdown_pct: 4, ratio: 1 }] });
  assert.equal(inferred.preset, "custom");
  assert.equal(inferred.levels.length, 1);

  const orphanCustom = normalizeAddPlanConfig({ preset: "custom" });
  assert.equal(orphanCustom.preset, "auto");
  assert.equal(orphanCustom.levels, null);

  // 非 custom 预设不携带 levels（档位由预设给出）
  const steady = normalizeAddPlanConfig({ preset: "steady", levels: [{ drawdown_pct: 9, ratio: 1 }] });
  assert.equal(steady.preset, "steady");
  assert.equal(steady.levels, null);

  const bogus = normalizeAddPlanConfig({ preset: "magic" });
  assert.equal(bogus.preset, "auto");
});

test("level amounts sum to budget", () => {
  const plan = buildAddPlan({
    price: 1.5,
    amount: 3000,
    assetClass: "equity_growth",
    mult: 1,
  });
  const total = plan.levels.reduce((sum, row) => sum + row.amount, 0);
  assert.ok(Math.abs(total - 3000) < 1e-9);
});

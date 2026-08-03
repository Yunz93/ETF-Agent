import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRebalanceSellSuggestions,
  sellAmountToWeight,
} from "../js/rebalance-sell.js";

const PLAN = {
  trading_cost: {
    min_commission: 5,
    commission_rate_pct: 0.03,
    max_fee_ratio_pct: 0.25,
    lot_size: 100,
  },
};

test("sellAmountToWeight solves post-trade weight exactly", () => {
  // V=10000, M=3000 (30%), sell to 25% → S = (3000 - 0.25*10000)/(0.75) = 666.666...
  const amount = sellAmountToWeight({ marketValue: 3000, totalValue: 10000, sellToWeight: 25 });
  assert.ok(Math.abs(amount - 2000 / 3) < 1e-6);
  const afterM = 3000 - amount;
  const afterV = 10000 - amount;
  assert.ok(Math.abs(afterM / afterV - 0.25) < 1e-9);
  assert.equal(sellAmountToWeight({ marketValue: 2000, totalValue: 10000, sellToWeight: 25 }), 0);
  assert.equal(sellAmountToWeight({ marketValue: 0, totalValue: 10000, sellToWeight: 20 }), 0);
});

test("valuation trim triggers when drift>10 and rich; growth needs >15", () => {
  const holdings = [
    {
      symbol: "512890",
      name: "红利",
      targetWeight: 20,
      actualWeight: 32,
      marketValue: 32000,
      pePct: 0.9,
      grade: "D",
      assetClass: "dividend",
      shares: 32000,
    },
    {
      symbol: "513390",
      name: "纳指",
      targetWeight: 15,
      actualWeight: 28,
      marketValue: 28000,
      pePct: 0.99,
      grade: "E",
      assetClass: "equity_growth",
      shares: 28000,
    },
    {
      symbol: "510300",
      name: "沪深300",
      targetWeight: 30,
      actualWeight: 40,
      marketValue: 40000,
      pePct: 0.5,
      grade: "C",
      assetClass: "equity_core",
      shares: 10000,
    },
  ];
  // total 100000
  const quotes = {
    "512890": { price: 1 },
    "513390": { price: 1 },
    "510300": { price: 4 },
  };
  const july = new Date("2026-07-15T10:00:00");
  const result = buildRebalanceSellSuggestions({ holdings, quotes, plan: PLAN, now: july });
  const symbols = result.map((row) => row.symbol);
  assert.ok(symbols.includes("512890"));
  assert.ok(!symbols.includes("513390")); // drift 13 < 15，成长类不触发
  assert.ok(!symbols.includes("510300")); // 未偏贵
});

test("equity_growth only trims when drift > 15pp", () => {
  const holdings = [
    {
      symbol: "513390",
      name: "纳指",
      targetWeight: 20,
      actualWeight: 32, // drift 12 — below 15
      marketValue: 32000,
      pePct: 0.99,
      grade: "E",
      assetClass: "equity_growth",
      shares: 32000,
    },
    {
      symbol: "510300",
      name: "沪深300",
      targetWeight: 80,
      actualWeight: 68,
      marketValue: 68000,
      pePct: 0.5,
      assetClass: "equity_core",
      shares: 17000,
    },
  ];
  const quotes = { "513390": { price: 1 }, "510300": { price: 4 } };
  const mild = buildRebalanceSellSuggestions({
    holdings,
    quotes,
    plan: PLAN,
    now: new Date("2026-07-15"),
  });
  assert.equal(mild.length, 0);

  const heavy = buildRebalanceSellSuggestions({
    holdings: [{ ...holdings[0], actualWeight: 38, marketValue: 38000, shares: 38000 }, holdings[1]],
    quotes,
    plan: PLAN,
    now: new Date("2026-07-15"),
  });
  assert.equal(heavy.length, 1);
  assert.equal(heavy[0].rule, "valuation_trim");
  assert.equal(heavy[0].sellToWeight, 25); // 20+5
  assert.ok(heavy[0].shares > 0);
  assert.equal(heavy[0].shares % 100, 0);
});

test("January annual rebalance sells back to target; prefers larger of two rules", () => {
  const holdings = [
    {
      symbol: "512890",
      name: "红利",
      targetWeight: 20,
      actualWeight: 35,
      marketValue: 35000,
      pePct: 0.9,
      grade: "E",
      assetClass: "dividend",
      shares: 35000,
    },
    {
      symbol: "510300",
      name: "沪深300",
      targetWeight: 80,
      actualWeight: 65,
      marketValue: 65000,
      pePct: 0.5,
      assetClass: "equity_core",
      shares: 16250,
    },
  ];
  const quotes = { "512890": { price: 1 }, "510300": { price: 4 } };
  const jan = buildRebalanceSellSuggestions({
    holdings,
    quotes,
    plan: PLAN,
    now: new Date("2026-01-10T10:00:00"),
  });
  assert.equal(jan.length, 1);
  assert.equal(jan[0].rule, "annual_rebalance"); // sell to 20 > sell to 25
  assert.equal(jan[0].sellToWeight, 20);

  const july = buildRebalanceSellSuggestions({
    holdings,
    quotes,
    plan: PLAN,
    now: new Date("2026-07-10"),
  });
  assert.equal(july.length, 1);
  assert.equal(july[0].rule, "valuation_trim");
  assert.equal(july[0].sellToWeight, 25);
});

test("missing price or tiny sell rounds to zero shares → no suggestion", () => {
  const holdings = [
    {
      symbol: "512890",
      targetWeight: 20,
      actualWeight: 31,
      marketValue: 50, // tiny
      pePct: 0.9,
      grade: "E",
      assetClass: "dividend",
      shares: 50,
    },
    {
      symbol: "510300",
      targetWeight: 80,
      actualWeight: 69,
      marketValue: 111,
      pePct: 0.5,
      assetClass: "equity_core",
      shares: 27,
    },
  ];
  const noPrice = buildRebalanceSellSuggestions({
    holdings,
    quotes: {},
    plan: PLAN,
    now: new Date("2026-07-15"),
  });
  assert.equal(noPrice.length, 0);

  const tiny = buildRebalanceSellSuggestions({
    holdings,
    quotes: { "512890": { price: 1 }, "510300": { price: 4 } },
    plan: PLAN,
    now: new Date("2026-07-15"),
  });
  assert.equal(tiny.length, 0);
});

test("grade E alone can trigger valuation trim without pePct", () => {
  const holdings = [
    {
      symbol: "512890",
      targetWeight: 25,
      actualWeight: 40,
      marketValue: 40000,
      pePct: null,
      grade: "E",
      assetClass: "dividend",
      shares: 40000,
    },
    {
      symbol: "510300",
      targetWeight: 75,
      actualWeight: 60,
      marketValue: 60000,
      assetClass: "equity_core",
      shares: 15000,
    },
  ];
  const result = buildRebalanceSellSuggestions({
    holdings,
    quotes: { "512890": { price: 1 }, "510300": { price: 4 } },
    plan: PLAN,
    now: new Date("2026-08-01"),
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].side, "sell");
  assert.equal(result[0].band, "估值止盈");
});

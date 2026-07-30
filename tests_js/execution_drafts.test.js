import test from "node:test";
import assert from "node:assert/strict";

import { state } from "../js/state.js";
import { normalizeExecutionDrafts } from "../js/workspace_model.js";
import {
  buildExecutionDraftsFromAllocation,
  executionDraftSummary,
  updateExecutionDraft,
} from "../js/execution-drafts.js";

test("execution draft normalization pads symbols and drops invalid rows", () => {
  const drafts = normalizeExecutionDrafts([
    {
      id: "draft_1",
      period: "2026-07-01",
      symbol: "512890",
      suggested_amount: 1200,
      price: 1.2,
      shares: 1000,
      fee: 5,
      date: "2026-07-30",
      status: "pending",
    },
    { period: "bad", symbol: "512890", suggested_amount: 100 },
    {
      period: "2026-07-01",
      symbol: "sh510300",
      suggested_amount: 800,
      price: 4,
      shares: 200,
      status: "skipped",
      skip_reason: "已手动下单",
    },
  ]);
  assert.equal(drafts.length, 2);
  assert.equal(drafts.find((item) => item.symbol === "510300").status, "skipped");
  assert.equal(drafts[0].period, "2026-07-01");
});

test("buildExecutionDraftsFromAllocation creates lot-sized pending drafts", () => {
  state.etfs = [
    { symbol: "512890", name: "红利低波ETF", shares: 0, target_weight: 60 },
    { symbol: "510300", name: "沪深300ETF", shares: 0, target_weight: 40 },
  ];
  state.quotesBySymbol = {
    "512890": { price: 1.0 },
    "510300": { price: 4.0 },
  };
  state.analysisCache = {
    "512890": { supported: true, valuation: { pe_percentile_10y: 0.15 }, score: { grade: "A" } },
    "510300": { supported: true, valuation: { pe_percentile_10y: 0.55 }, score: { grade: "C" } },
  };
  state.plan = {
    name: "测试",
    amount: 5000,
    capital_base: 0,
    initial_target_pct: 0,
    cadence: "monthly",
    day: 1,
    strategy: "valuation",
    strategy_config: {
      pe_bands: [
        { max_pct: 20, mult: 1.5, label: "低估区" },
        { max_pct: 40, mult: 1.2, label: "偏低区" },
        { max_pct: 60, mult: 1.0, label: "正常区" },
        { max_pct: 80, mult: 0.5, label: "偏高区" },
        { max_pct: 100, mult: 0, label: "高估区" },
      ],
      grade_mult: { A: 1.5, B: 1.2, C: 1.0, D: 0.5, E: 0 },
      use_rebalance: true,
    },
    trading_cost: {
      min_commission: 5,
      commission_rate_pct: 0.03,
      max_fee_ratio_pct: 0.25,
      lot_size: 100,
    },
    pending_orders: {},
  };
  state.executionDrafts = [];
  state.buys = [];
  state.sells = [];

  const drafts = buildExecutionDraftsFromAllocation({ now: new Date("2026-07-15T10:00:00") });
  assert.ok(drafts.length >= 1);
  assert.ok(drafts.every((item) => item.shares % 100 === 0));
  assert.ok(drafts.every((item) => item.status === "pending"));
  assert.ok(drafts.every((item) => item.period === "2026-07-01"));
});

test("updateExecutionDraft preserves confirmed rows when regenerating", () => {
  state.etfs = [{ symbol: "512890", name: "红利低波ETF", shares: 0, target_weight: 100 }];
  state.quotesBySymbol = { "512890": { price: 1.0 } };
  state.analysisCache = {
    "512890": { supported: true, valuation: { pe_percentile_10y: 0.15 }, score: { grade: "A" } },
  };
  state.plan = {
    amount: 3000,
    capital_base: 0,
    initial_target_pct: 0,
    cadence: "monthly",
    day: 1,
    strategy: "fixed",
    strategy_config: null,
    trading_cost: {
      min_commission: 5,
      commission_rate_pct: 0.03,
      max_fee_ratio_pct: 0.25,
      lot_size: 100,
    },
    pending_orders: {},
  };
  state.executionDrafts = [];
  const created = buildExecutionDraftsFromAllocation({ now: new Date("2026-07-15T10:00:00") });
  assert.ok(created.length >= 1);
  const firstId = created[0].id;
  state.executionDrafts = created;
  state.executionDrafts = updateExecutionDraft(firstId, { status: "confirmed", confirmed_trade_id: "buy_1" });
  const regenerated = buildExecutionDraftsFromAllocation({ now: new Date("2026-07-15T10:00:00") });
  const kept = regenerated.find((item) => item.id === firstId);
  assert.equal(kept.status, "confirmed");
  state.executionDrafts = regenerated;
  const summary = executionDraftSummary(new Date("2026-07-15T10:00:00"));
  assert.equal(summary.pending, regenerated.filter((item) => item.status === "pending").length);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPortfolioReviewBaseline,
  isPortfolioAiReady,
  portfolioReviewResultHtml,
  validatePortfolioAiAmounts,
} from "../js/ai-portfolio.js";

test("buildPortfolioReviewBaseline maps allocatePoolBudget fields", () => {
  const baseline = buildPortfolioReviewBaseline(
    {
      budget: 2000,
      deployTotal: 1800,
      cashKeep: 200,
      cashRelease: 500,
      strategy: "valuation",
      allocations: [{ symbol: "512890", name: "红利", amount: 1000, band: "低估区", mult: 1.5 }],
      skipped: [{ symbol: "510300", name: "沪深300", reason: "当期不建议新增", band: "高估区" }],
    },
    "fixed",
  );
  assert.equal(baseline.deploy_total, 1800);
  assert.equal(baseline.cash_release, 500);
  assert.equal(baseline.strategy, "valuation");
  assert.equal(baseline.allocations[0].amount, 1000);
  assert.equal(baseline.skipped[0].reason, "当期不建议新增");
});

test("isPortfolioAiReady gates on enabled and key", () => {
  assert.equal(isPortfolioAiReady({ ai: { enabled: false } }).ok, false);
  assert.equal(
    isPortfolioAiReady({
      ai: { enabled: true, provider: "deepseek", credentials: { deepseek: { configured: false } } },
    }).reason,
    "missing_key",
  );
  assert.equal(
    isPortfolioAiReady({
      ai: { enabled: true, provider: "deepseek", credentials: { deepseek: { configured: true } } },
    }).ok,
    true,
  );
});

test("portfolioReviewResultHtml hides unverified changed amounts and avoids idle chrome", () => {
  assert.equal(portfolioReviewResultHtml({ status: "idle" }), "");
  const html = portfolioReviewResultHtml({
    status: "ready",
    result: {
      provider: "deepseek",
      model: "flash",
      disclaimer: "仅供研究参考",
      ai_proposal: {
        focus_title: "红利超配",
        summary: "建议略降红利份额。",
        analysis_sections: [{ title: "仓位", items: ["红利高于目标。"] }],
        watch_items: ["观察利差"],
        data_limitations: [],
      },
      final_allocations: [
        { symbol: "512890", name: "红利", rule_amount: 1200, final_amount: 900, changed: true },
        { symbol: "510300", name: "沪深300", rule_amount: 800, final_amount: 800, changed: false },
      ],
    },
  });
  assert.match(html, /建议略降红利份额/);
  assert.ok(!html.includes("¥900.00"));
  assert.match(html, /暂不展示调整金额/);
  assert.ok(!html.includes("ai-review-focus"));
  assert.ok(!html.includes("沪深300：规则")); // 未变更不列
  assert.match(html, /仅供研究参考/);
});


function executionFixture() {
  const now = new Date("2026-09-16T02:00:00Z");
  return {
    now,
    context: {
      plan: { amount: 2000, strategy: "fixed", cadence: "monthly", trading_cost: { lot_size: 100, min_commission: 0, commission_rate_pct: 0, max_fee_ratio_pct: 1 } },
      etfs: [{ symbol: "513100", name: "纳指", shares: 100, target_weight: 100 }],
      quotesBySymbol: { "513100": { price: 2, market_timestamp: now.toISOString(), product_quality: { premium_discount_pct: 0, bid_ask_spread_pct: 0.05 } } },
      executionDrafts: [],
    },
    result: {
      requires_execution_validation: true,
      review_plan: { strategy: "fixed" },
      baseline: { cash_release: 0 },
      holdings: [{ symbol: "513100", shares: 100, target_weight: 100, index_code: "NDX" }],
      final_allocations: [{ symbol: "513100", name: "纳指", rule_amount: 1000, final_amount: 1200, changed: true }],
    },
  };
}

test("AI candidate passes the shared trade planner only with executable lots", () => {
  const { result, context, now } = executionFixture();
  const validation = validatePortfolioAiAmounts(result, context, {}, now);
  assert.equal(validation.ok, true);
  assert.equal(validation.allocations[0].shares, 600);
  assert.equal(context.executionDrafts.length, 0); // Validation never saves a draft.
  context.plan.trading_cost = { lot_size: 100, min_commission: 5, max_fee_ratio_pct: 0.05 };
  assert.equal(validatePortfolioAiAmounts(result, context, {}, now).ok, false);
});

test("AI candidate cannot override cross-border premium or missing quote checks", () => {
  const { result, context, now } = executionFixture();
  context.quotesBySymbol["513100"].product_quality.premium_discount_pct = 8;
  assert.equal(validatePortfolioAiAmounts(result, context, {}, now).ok, false);
  context.quotesBySymbol["513100"].product_quality.premium_discount_pct = null;
  assert.equal(validatePortfolioAiAmounts(result, context, {}, now).ok, false);
  delete context.quotesBySymbol["513100"];
  assert.equal(validatePortfolioAiAmounts(result, context, {}, now).ok, false);
});

test("AI candidate cannot exceed current budget or initial target gap", () => {
  const { result, context, now } = executionFixture();
  context.plan.amount = 1000;
  assert.equal(validatePortfolioAiAmounts(result, context, {}, now).ok, false);
  context.plan = { ...context.plan, amount: 2000, capital_base: 1000, initial_target_pct: 60, initial_months: 1 };
  assert.equal(validatePortfolioAiAmounts(result, context, {}, now).ok, false);
});

test("AI candidate is invalidated after positions or target weights change", () => {
  const { result, context, now } = executionFixture();
  context.etfs[0].shares = 200;
  assert.equal(validatePortfolioAiAmounts(result, context, {}, now).ok, false);
  context.etfs[0].shares = 100;
  context.etfs[0].target_weight = 90;
  assert.equal(validatePortfolioAiAmounts(result, context, {}, now).ok, false);
});


test("AI candidate is invalidated after the reviewed plan changes", () => {
  const { result, context, now } = executionFixture();
  context.plan.strategy = "valuation";
  assert.equal(validatePortfolioAiAmounts(result, context, {}, now).ok, false);
});

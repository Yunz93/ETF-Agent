/**
 * 本期执行清单草稿：建议金额 → 整手份额 → 确认入账 / 跳过。
 */

import { state } from "./state.js";
import {
  orderPreview,
  planExecutionContext,
  planPeriod,
} from "./decision-support.js";
import { allocatePoolBudget } from "./strategy.js";
import { buildPoolHoldingsForAllocation } from "./pool-alloc.js";
import { buildRebalanceSellSuggestions } from "./rebalance-sell.js";
import { normalizeExecutionDrafts, normalizeTradingCost } from "./workspace_model.js";
import {
  analysisRegistryFromConfig,
  sentimentByMarketFromState,
} from "./market-sentiment.js";

function todayKey(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function draftId(period, symbol, side = "buy") {
  return side === "sell" ? `draft_${period}_${symbol}_sell` : `draft_${period}_${symbol}`;
}

/** 根据当前全池分配生成/刷新本期 pending 草稿（保留已确认/跳过）。 */
export function buildExecutionDraftsFromAllocation({ now = new Date() } = {}) {
  const plan = state.plan || {};
  const period = planPeriod(plan, now);
  const holdings = buildPoolHoldingsForAllocation();
  const execution = planExecutionContext({ plan, holdings });
  const pool = allocatePoolBudget({
    budget: execution.budget,
    holdings,
    strategy: plan.strategy,
    strategyConfig: plan.strategy_config,
    strategyOverrides: plan.strategy_overrides,
    preferTargetGap: execution.phase === "initial",
    sentimentByMarket: sentimentByMarketFromState(),
    analysisRegistry: analysisRegistryFromConfig(),
  });
  const tradingCost = normalizeTradingCost(plan.trading_cost);
  const existing = normalizeExecutionDrafts(state.executionDrafts || []);
  const kept = existing.filter(
    (item) => item.period === period.start && (item.status === "confirmed" || item.status === "skipped"),
  );
  const keptIds = new Set(kept.map((item) => item.id));
  const otherPeriods = existing.filter((item) => item.period !== period.start);
  const date = todayKey(now);
  const created = [];

  for (const row of pool.allocations || []) {
    if (!(row.amount > 0)) continue;
    const id = draftId(period.start, row.symbol, "buy");
    if (keptIds.has(id)) continue;
    const quote = state.quotesBySymbol[row.symbol];
    const cached = state.analysisCache[row.symbol];
    const price = Number(quote?.price ?? cached?.etf?.price ?? cached?.price) || 0;
    const preview = orderPreview(row.amount, price, tradingCost);
    if (!(preview.shares > 0) || !(price > 0)) continue;
    created.push({
      id,
      period: period.start,
      symbol: row.symbol,
      name: row.name || quote?.name || row.symbol,
      side: "buy",
      suggested_amount: Math.round(row.amount * 100) / 100,
      price: Math.round(price * 1e6) / 1e6,
      shares: preview.shares,
      fee: preview.fee,
      date,
      status: "pending",
      skip_reason: "",
      confirmed_trade_id: null,
      note: "",
    });
  }

  // 卖出纪律建议（确认制，绝不自动下单）
  const holdingsWithShares = holdings.map((item) => {
    const etf = (state.etfs || []).find((row) => row.symbol === item.symbol);
    return {
      ...item,
      shares: Math.max(0, Number(etf?.shares) || 0) || undefined,
    };
  });
  const sellSuggestions = buildRebalanceSellSuggestions({
    holdings: holdingsWithShares,
    quotes: state.quotesBySymbol,
    plan,
    now,
  });
  for (const row of sellSuggestions) {
    const id = draftId(period.start, row.symbol, "sell");
    if (keptIds.has(id)) continue;
    created.push({
      id,
      period: period.start,
      symbol: row.symbol,
      name: row.name,
      side: "sell",
      suggested_amount: row.suggested_amount,
      price: row.price,
      shares: row.shares,
      fee: row.fee,
      date,
      status: "pending",
      skip_reason: "",
      confirmed_trade_id: null,
      note: row.hint || row.band || "",
    });
  }

  return normalizeExecutionDrafts([...otherPeriods, ...kept, ...created]);
}

export function currentPeriodDrafts(now = new Date()) {
  const period = planPeriod(state.plan || {}, now);
  return normalizeExecutionDrafts(state.executionDrafts || []).filter(
    (item) => item.period === period.start,
  );
}

export function executionDraftSummary(now = new Date()) {
  const drafts = currentPeriodDrafts(now);
  const suggested = drafts.reduce((sum, item) => sum + (Number(item.suggested_amount) || 0), 0);
  const executed = drafts
    .filter((item) => item.status === "confirmed")
    .reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.shares) || 0), 0);
  const pending = drafts.filter((item) => item.status === "pending").length;
  return {
    period: planPeriod(state.plan || {}, now).start,
    suggested: Math.round(suggested * 100) / 100,
    executed: Math.round(executed * 100) / 100,
    pending,
    total: drafts.length,
    drafts,
  };
}

export function updateExecutionDraft(id, patch) {
  const drafts = normalizeExecutionDrafts(state.executionDrafts || []);
  const next = drafts.map((item) => (item.id === id ? { ...item, ...patch, id: item.id } : item));
  return normalizeExecutionDrafts(next);
}

export { normalizeExecutionDrafts };

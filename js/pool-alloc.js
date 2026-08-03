import { PLAN_CADENCE_LABELS } from "./constants.js";
import { appConfig, state } from "./state.js";
import { escapeAttr, escapeHtml, money, resolveEtfDisplayName } from "./utils.js";
import { allocatePoolBudget, strategyLabel } from "./strategy.js";
import { planExecutionContext, planPeriod } from "./decision-support.js";
import {
  analysisCacheKey,
  analysisPrefetchIsPreliminary,
  isAnalysisUsable,
} from "./analysis-cache.js";
import {
  analysisRegistryFromConfig,
  sentimentByMarketFromState,
} from "./market-sentiment.js";
import { goldMacroFromState } from "./gold-macro.js";

function cacheKey(symbol) {
  return analysisCacheKey(symbol);
}

function poolEntryDisplayName(entry, cached) {
  const registryName =
    appConfig?.etf?.analysis_registry?.[entry.symbol]?.etf_name ||
    appConfig?.etf?.analysis_support?.[entry.symbol]?.etf_name ||
    cached?.etf_name ||
    "";
  const seedName = (appConfig?.etf?.pool || []).find((item) => item.symbol === entry.symbol)?.name || "";
  return resolveEtfDisplayName({
    name: entry.name,
    symbol: entry.symbol,
    quoteName: state.quotesBySymbol[entry.symbol]?.name,
    registryName,
    seedName,
  });
}

/** 用持仓 + 分析缓存组装全池分配输入。 */
export function buildPoolHoldingsForAllocation({ preferLive = null } = {}) {
  const live = preferLive && !preferLive.error ? preferLive : null;
  const liveSymbol = live?.symbol || state.analysisSymbol || null;
  let total = 0;
  const valueMap = {};
  state.etfs.forEach((item) => {
    const quote = state.quotesBySymbol[item.symbol];
    const livePrice =
      liveSymbol === item.symbol
        ? live?.etf?.price ?? live?.price
        : null;
    const price = livePrice ?? quote?.price;
    if (price != null) {
      const shares = Math.max(0, Number(item.shares) || 0);
      valueMap[item.symbol] = shares * price;
      total += valueMap[item.symbol];
    }
  });
  return state.etfs.map((entry) => {
    const cached =
      live && liveSymbol === entry.symbol ? live : state.analysisCache[cacheKey(entry.symbol)];
    const analyzed = isAnalysisUsable(cached);
    const actualWeight =
      valueMap[entry.symbol] != null ? (total > 0 ? (valueMap[entry.symbol] / total) * 100 : 0) : null;
    return {
      symbol: entry.symbol,
      name: poolEntryDisplayName(entry, cached),
      targetWeight: Number(entry.target_weight) > 0 ? Number(entry.target_weight) : 0,
      actualWeight,
      marketValue: valueMap[entry.symbol] ?? 0,
      pePct: analyzed ? cached?.valuation?.pe_percentile_10y : null,
      grade: analyzed ? cached?.score?.grade : null,
      assetClass: analyzed ? cached?.asset_class || null : null,
      spreadPct: analyzed ? cached?.spread?.percentile ?? null : null,
      biasPct: analyzed ? cached?.technicals?.bias_pct ?? null : null,
      goldMacro: analyzed ? cached?.gold_macro || null : null,
      analyzed,
    };
  });
}

function dataStatusBadge(analyzed) {
  return analyzed
    ? `<span class="pool-alloc-badge is-ready" title="已用分析缓存参与分配">已分析</span>`
    : `<span class="pool-alloc-badge is-neutral" title="暂无分析，按中性倍率参与分配">中性兜底</span>`;
}

function progressNoteHtml(holdings) {
  const total = holdings.length;
  const analyzed = holdings.filter((item) => item.analyzed).length;
  const prefetch = state.analysisPrefetch || {};
  if (prefetch.status === "done" || total === 0) return "";
  const done = Math.min(total, Math.max(analyzed, Number(prefetch.done) || 0));
  if (prefetch.status === "running") {
    return `<p class="muted pool-alloc-note pool-alloc-progress">分析中 ${done}/${total} · 金额为初步值</p>`;
  }
  if (analyzed < total) {
    return `<p class="muted pool-alloc-note pool-alloc-progress">分析中 ${analyzed}/${total} · 金额为初步值</p>`;
  }
  return "";
}

/** 轻量读取本期草稿摘要，避免与 execution-drafts 循环依赖。 */
function draftSummaryFromState() {
  const period = planPeriod(state.plan || {}).start;
  const drafts = (Array.isArray(state.executionDrafts) ? state.executionDrafts : []).filter(
    (item) => item && item.period === period,
  );
  const suggested = drafts.reduce((sum, item) => sum + (Number(item.suggested_amount) || 0), 0);
  const executed = drafts
    .filter((item) => item.status === "confirmed")
    .reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.shares) || 0), 0);
  const pending = drafts.filter((item) => item.status === "pending").length;
  return {
    drafts,
    suggested: Math.round(suggested * 100) / 100,
    executed: Math.round(executed * 100) / 100,
    pending,
    total: drafts.length,
  };
}

export function poolAllocationHtml({ highlightSymbol = null, clickable = true } = {}) {
  const plan = state.plan || {};
  const cadenceLabel = PLAN_CADENCE_LABELS[plan.cadence] || "每月";
  const dayLabel = plan.cadence === "monthly" ? `${plan.day || 1} 号` : `周${plan.day || 1}`;
  const holdings = buildPoolHoldingsForAllocation();
  const execution = planExecutionContext({ plan, holdings });
  const cashBalance = Number(plan.cash_reserve?.balance) || 0;
  const pool = allocatePoolBudget({
    budget: execution.budget,
    holdings,
    strategy: plan.strategy,
    strategyConfig: plan.strategy_config,
    strategyOverrides: plan.strategy_overrides,
    preferTargetGap: execution.phase === "initial",
    sentimentByMarket: sentimentByMarketFromState(),
    analysisRegistry: analysisRegistryFromConfig(),
    goldMacro: goldMacroFromState(),
    cashReserve: cashBalance,
  });
  const strategyName = strategyLabel(plan.strategy);
  const preliminary = analysisPrefetchIsPreliminary();
  const analyzedMap = Object.fromEntries(holdings.map((item) => [item.symbol, item.analyzed]));

  if (!(execution.budget > 0) || !holdings.length) {
    return `
      <section class="panel-block pool-alloc-block" aria-label="全池本期分配">
        <div class="panel-heading">
          <div>
            <h2 class="section-title">全池本期分配</h2>
            <p class="muted">${execution.phase === "initial" ? "建仓目标已完成或尚未配置" : "先填写周期预算与目标仓位"}</p>
          </div>
        </div>
      </section>
    `;
  }

  const rows = (pool.allocations || [])
    .concat(
      (pool.skipped || []).map((item) => ({
        symbol: item.symbol,
        name: item.name,
        amount: 0,
        band: item.band,
      })),
    )
    .sort((a, b) => b.amount - a.amount);

  const noteParts = [];
  if (pool.note) noteParts.push(pool.note);
  noteParts.unshift(`${execution.phaseLabel} · ${strategyName}策略`);
  const progressNote = progressNoteHtml(holdings);
  const prelimClass = preliminary ? " is-preliminary" : "";
  const prelimTag = preliminary ? `<em class="pool-alloc-prelim-tag">初步</em>` : "";
  // 概览只保留一行执行摘要；完整清单统一放在「交易记录」页，避免重复。
  const draftSummary = draftSummaryFromState();
  let draftStatus = "";
  if (draftSummary.total > 0) {
    const parts = [];
    if (draftSummary.pending > 0) parts.push(`待执行 ${draftSummary.pending} 笔`);
    if (draftSummary.executed > 0) parts.push(`已执行 ${money(draftSummary.executed)}`);
    if (!parts.length) parts.push("已处理完毕");
    draftStatus = `<p class="muted pool-alloc-exec-summary">本期执行清单：${parts.join(" · ")} <button class="link-button" type="button" data-open-buys>去交易记录处理</button></p>`;
  }

  return `
    <section class="panel-block pool-alloc-block" aria-label="全池本期分配">
      <div class="panel-heading">
        <div>
          <h2 class="section-title">全池本期分配</h2>
            <p class="muted">${
              execution.phase === "initial"
                ? `目标 ${money(execution.targetAmount)} · 分 ${execution.initialMonths} 个月 · 本期 ${money(execution.budget)} · 尚缺 ${money(execution.initialGap)}`
                : `${escapeHtml(plan.name || "定投计划")} · ${escapeHtml(cadenceLabel)}${escapeHtml(String(dayLabel))}`
            }</p>
        </div>
        <button class="primary-button compact" type="button" data-generate-exec-drafts>生成本期执行清单</button>
      </div>
      <div class="pool-alloc-summary${prelimClass}">
        <div class="pool-alloc-metric"><span>${execution.phase === "initial" ? "建仓缺口" : "本期预算"}</span><strong>${money(pool.budget)}</strong></div>
        <div class="pool-alloc-metric"><span>建议部署${prelimTag}</span><strong>${money(pool.deployTotal)}</strong></div>
        <div class="pool-alloc-metric"><span>留现金</span><strong>${money(pool.cashKeep)}</strong></div>
        <div class="pool-alloc-metric"><span>现金池</span><strong>${money(cashBalance)}</strong></div>
      </div>
      ${draftStatus}
      <div class="dca-alloc-table" aria-label="各品种建议金额">
        <div class="dca-alloc-head"><span>品种</span><span>区间</span><span class="num">建议金额</span></div>
        ${rows
          .map((row) => {
            const active = highlightSymbol && row.symbol === highlightSymbol ? " is-current" : "";
            const analyzed = Boolean(analyzedMap[row.symbol]);
            const amountClass = preliminary ? "num is-preliminary" : "num";
            const nameCell = clickable
              ? `<button class="link-button pool-alloc-name" type="button" data-analyze="${escapeAttr(row.symbol)}">${escapeHtml(row.name)}${dataStatusBadge(analyzed)}</button>`
              : `<span>${escapeHtml(row.name)}${dataStatusBadge(analyzed)}</span>`;
            return `<div class="dca-alloc-row${active}">${nameCell}<span>${escapeHtml(row.band || "—")}</span><span class="${amountClass}">${row.amount > 0 ? money(row.amount) : "不投"}</span></div>`;
          })
          .join("")}
      </div>
      ${progressNote}
      ${noteParts.length ? `<p class="muted pool-alloc-note">${escapeHtml(noteParts.join(" "))}</p>` : ""}
    </section>
  `;
}

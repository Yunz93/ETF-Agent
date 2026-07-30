import { PLAN_CADENCE_LABELS } from "./constants.js";
import { state } from "./state.js";
import { escapeAttr, escapeHtml, money } from "./utils.js";
import { allocatePoolBudget, strategyLabel } from "./strategy.js";
import { planExecutionContext } from "./decision-support.js";

function cacheKey(symbol) {
  return symbol || "__default__";
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
    if (price != null && item.shares > 0) {
      valueMap[item.symbol] = price * item.shares;
      total += valueMap[item.symbol];
    }
  });
  return state.etfs.map((entry) => {
    const cached =
      live && liveSymbol === entry.symbol ? live : state.analysisCache[cacheKey(entry.symbol)];
    const analyzed = Boolean(cached && cached.supported !== false && !cached.error);
    const actualWeight = valueMap[entry.symbol] != null && total > 0 ? (valueMap[entry.symbol] / total) * 100 : null;
    return {
      symbol: entry.symbol,
      name: entry.name || cached?.etf_name || entry.symbol,
      targetWeight: Number(entry.target_weight) > 0 ? Number(entry.target_weight) : 0,
      actualWeight,
      marketValue: valueMap[entry.symbol] ?? 0,
      pePct: analyzed ? cached?.valuation?.pe_percentile_10y : null,
      grade: analyzed ? cached?.score?.grade : null,
      analyzed,
    };
  });
}

export function poolAllocationHtml({ highlightSymbol = null, clickable = true } = {}) {
  const plan = state.plan || {};
  const cadenceLabel = PLAN_CADENCE_LABELS[plan.cadence] || "每月";
  const dayLabel = plan.cadence === "monthly" ? `${plan.day || 1} 号` : `周${plan.day || 1}`;
  const holdings = buildPoolHoldingsForAllocation();
  const execution = planExecutionContext({ plan, holdings });
  const pool = allocatePoolBudget({
    budget: execution.budget,
    holdings,
    strategy: plan.strategy,
    strategyConfig: plan.strategy_config,
    preferTargetGap: execution.phase === "initial",
  });
  const strategyName = strategyLabel(plan.strategy);

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

  const missingN = holdings.filter((item) => !item.analyzed).length;
  const noteParts = [];
  if (pool.note) noteParts.push(pool.note);
  if (missingN > 0) noteParts.push(`${missingN} 只未分析，暂按中性`);
  noteParts.unshift(`${execution.phaseLabel} · ${strategyName}策略`);

  return `
    <section class="panel-block pool-alloc-block" aria-label="全池本期分配">
      <div class="panel-heading">
        <div>
          <h2 class="section-title">全池本期分配</h2>
            <p class="muted">${
              execution.phase === "initial"
                ? `目标 ${money(execution.targetAmount)} · 尚缺 ${money(execution.initialGap)}`
                : `${escapeHtml(plan.name || "定投计划")} · ${escapeHtml(cadenceLabel)}${escapeHtml(String(dayLabel))}`
            }</p>
        </div>
      </div>
      <div class="pool-alloc-summary">
        <div class="pool-alloc-metric"><span>${execution.phase === "initial" ? "建仓缺口" : "本期预算"}</span><strong>${money(pool.budget)}</strong></div>
        <div class="pool-alloc-metric"><span>建议部署</span><strong>${money(pool.deployTotal)}</strong></div>
        <div class="pool-alloc-metric"><span>留现金</span><strong>${money(pool.cashKeep)}</strong></div>
      </div>
      <div class="dca-alloc-table" aria-label="各品种建议金额">
        <div class="dca-alloc-head"><span>品种</span><span>区间</span><span class="num">建议金额</span></div>
        ${rows
          .map((row) => {
            const active = highlightSymbol && row.symbol === highlightSymbol ? " is-current" : "";
            const nameCell = clickable
              ? `<button class="link-button pool-alloc-name" type="button" data-analyze="${escapeAttr(row.symbol)}">${escapeHtml(row.name)}</button>`
              : `<span>${escapeHtml(row.name)}</span>`;
            return `<div class="dca-alloc-row${active}">${nameCell}<span>${escapeHtml(row.band || "—")}</span><span class="num">${row.amount > 0 ? money(row.amount) : "不投"}</span></div>`;
          })
          .join("")}
      </div>
      ${noteParts.length ? `<p class="muted pool-alloc-note">${escapeHtml(noteParts.join(" "))}</p>` : ""}
    </section>
  `;
}

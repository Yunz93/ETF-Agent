/**
 * 全池 AI 审视：用规则引擎 allocatePoolBudget 结果作基线，仅展示不改草稿。
 */

import { appConfig, state } from "./state.js";
import { aiProviderLabel, escapeHtml, money } from "./utils.js";
import { buildTradePlan } from "./trade-plan.js";
import { planExecutionContext } from "./decision-support.js";
import { isAnalysisUsable } from "./analysis-cache.js";

/** 从全池分配结果组装后端 baseline。 */
export function buildPortfolioReviewBaseline(pool, strategy = "valuation") {
  const source = pool && typeof pool === "object" ? pool : {};
  return {
    budget: Math.max(0, Number(source.budget) || 0),
    deploy_total: Math.max(0, Number(source.deployTotal) || 0),
    cash_keep: Math.max(0, Number(source.cashKeep) || 0),
    cash_release: Math.max(0, Number(source.cashRelease) || 0),
    strategy: String(source.strategy || strategy || "valuation"),
    allocations: (source.allocations || []).map((row) => ({
      symbol: row.symbol,
      name: row.name || row.symbol,
      amount: Math.max(0, Number(row.amount) || 0),
      band: row.band || "",
      mult: Number(row.mult) || 1,
    })),
    skipped: (source.skipped || []).map((row) => ({
      symbol: row.symbol,
      name: row.name || row.symbol,
      reason: row.reason || row.band || "",
    })),
  };
}

export function isPortfolioAiReady(config = appConfig) {
  const ai = config?.ai;
  if (!ai || ai.enabled !== true) return { ok: false, reason: "disabled" };
  const provider = ai.provider || "deepseek";
  if (!ai.credentials?.[provider]?.configured) {
    return { ok: false, reason: "missing_key" };
  }
  return { ok: true, provider };
}

function sectionsHtml(proposal) {
  const sections = proposal?.analysis_sections || [];
  if (!sections.length) return "";
  return `<div class="ai-review-sections">${sections
    .map(
      (section) => `
      <div class="ai-review-section">
        <strong>${escapeHtml(section.title || "")}</strong>
        <ul>${(section.items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>`,
    )
    .join("")}</div>`;
}

function listBlock(title, items) {
  if (!items?.length) return "";
  return `<div class="ai-review-watch"><strong>${escapeHtml(title)}</strong><ul>${items
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("")}</ul></div>`;
}

/** AI amounts remain research candidates until the same deterministic order planner approves them. */
export function validatePortfolioAiAmounts(result, context = state, config = appConfig, now = new Date()) {
  const reject = (reason) => ({ ok: false, reasons: [reason], allocations: [] });
  if (result?.requires_execution_validation !== true) return reject("旧版分析未包含完整执行依据，请重新审视。");
  const source = result.final_allocations || [];
  const etfs = context.etfs || [];
  const facts = new Map((result.holdings || []).map((row) => [row.symbol, row]));
  const quotes = context.quotesBySymbol || {};
  const plan = context.plan || {};
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    return value ?? null;
  };
  if (!result.review_plan || Object.entries(result.review_plan).some(([key, value]) =>
    JSON.stringify(canonical(value)) !== JSON.stringify(canonical(plan[key]))
  )) return reject("计划参数已变化或快照缺失，请重新审视。");
  const holdings = etfs.map((item) => {
    const quote = quotes[item.symbol];
    const fact = facts.get(item.symbol);
    const analysis = context.analysisCache?.[item.symbol];
    const analyzed = isAnalysisUsable(analysis);
    const price = Number(quote?.price);
    const shares = Math.max(0, Number(item.shares) || 0);
    return {
      symbol: item.symbol, name: item.name, shares,
      targetWeight: Number(item.target_weight) || 0,
      marketValue: price > 0 ? shares * price : 0,
      quoteMissing: !(price > 0),
      indexCode: config?.etf?.analysis_registry?.[item.symbol]?.index_code || config?.etf?.analysis_support?.[item.symbol]?.index_code || fact?.index_code || "",
      assetClass: analysis?.asset_class || fact?.asset_class || null,
      pePct: analyzed ? analysis.valuation?.pe_percentile_10y ?? null : null,
      grade: analyzed ? analysis.score?.grade ?? null : null,
      spreadPct: analyzed ? analysis.spread?.percentile ?? null : null,
      biasPct: analyzed ? analysis.technicals?.bias_pct ?? null : null,
      analyzed,
    };
  });
  if (!holdings.length || holdings.some((row) => row.quoteMissing)) return reject("持仓行情不完整，暂不展示调整金额。");
  // A cached model opinion cannot authorize a different position or plan.
  if (holdings.some((row) => {
    const fact = facts.get(row.symbol);
    return !fact || fact.shares !== row.shares || fact.target_weight !== row.targetWeight;
  })) return reject("持仓或目标已变化，请重新审视。");
  if (source.length !== new Set(source.map((row) => row.symbol)).size || source.some((row) =>
    !holdings.some((holding) => holding.symbol === row.symbol) ||
    !Number.isFinite(row.final_amount) || row.final_amount < 0
  )) return reject("调整明细不完整，暂不展示调整金额。");
  const execution = planExecutionContext({ plan, holdings, now });
  const requested = source.reduce((total, row) => total + row.final_amount, 0);
  const reserve = Math.max(0, Number(plan.cash_reserve?.balance) || 0);
  const release = Math.min(reserve, Math.max(0, Number(result.baseline?.cash_release) || 0));
  if (requested > execution.budget + release + 0.01) return reject("调整总额超过当前可用预算。");
  if (execution.phase === "initial" && source.some((row) => {
    const holding = holdings.find((item) => item.symbol === row.symbol);
    const gap = Math.max(0, execution.targetAmount * holding.targetWeight / 100 - holding.marketValue);
    return row.final_amount > gap + 0.01;
  })) return reject("调整金额超过初始建仓剩余目标。");
  const candidate = buildTradePlan({
    plan, holdings, quotes, now, existingDrafts: context.executionDrafts || [],
    poolAllocation: { allocations: source.map((row) => ({ ...row, amount: row.final_amount })) },
  });
  const positive = source.filter((row) => row.final_amount > 0);
  const blocked = candidate.buyDrafts.filter((row) => row.readiness_status !== "ready" || !(row.shares > 0));
  if (candidate.conflicts.length || blocked.length || candidate.buyDrafts.length !== positive.length) {
    return reject(blocked.flatMap((row) => row.readiness_reasons || []).join("；") || "本期交易状态或方向冲突，暂不展示调整金额。");
  }
  return { ok: true, reasons: [], allocations: candidate.buyDrafts };
}

/** 渲染全池 AI 结果卡片（纯展示，不含结论数字复述）。 */
export function portfolioReviewResultHtml(review) {
  if (!review || review.status === "idle") return "";
  if (review.status === "loading") {
    return `
      <section class="panel-block ai-portfolio-card is-loading" aria-live="polite" aria-label="AI 全池审视">
        <div class="panel-heading"><div><h3 class="section-title">AI 全池审视</h3></div></div>
        <p class="muted ai-review-status">正在审视本期全池分配…</p>
      </section>`;
  }
  if (review.status === "error") {
    return `
      <section class="panel-block ai-portfolio-card is-error" aria-label="AI 全池审视">
        <div class="panel-heading">
          <div><h3 class="section-title">AI 全池审视</h3></div>
          <button class="ghost-button compact" type="button" data-ai-portfolio-review>重试</button>
        </div>
        <p class="down ai-review-status">${escapeHtml(review.error || "请求失败")}</p>
        <p class="muted">规则分配仍有效。</p>
      </section>`;
  }
  const result = review.result;
  if (!result) return "";
  const proposal = result.ai_proposal || {};
  const changed = (result.final_allocations || []).filter((row) => row.changed);
  const headline = proposal.summary || "模型未提供摘要";
  // 摘要已承载主结论；旁路只补新信息（分节、修正明细、观察、限制）
  const validation = changed.length ? validatePortfolioAiAmounts(result) : null;
  const adjustmentsHtml = changed.length && validation.ok
    ? `<div class="ai-portfolio-adjustments" aria-label="建议修正">
        <strong>通过当前执行核验的预算提案</strong>
        <ul>${changed
          .map(
            (row) =>
              `<li>${escapeHtml(row.name || row.symbol)}：规则 ${money(row.rule_amount)} → ${money(row.final_amount)}（仍需在今日执行确认）</li>`,
          )
          .join("")}</ul>
      </div>`
    : changed.length
      ? listBlock("执行核验", ["暂不展示调整金额。" + validation.reasons.join("；")])
      : "";
  return `
    <section class="panel-block ai-portfolio-card" aria-label="AI 全池审视">
      <div class="panel-heading">
        <div>
          <h3 class="section-title">AI 全池审视</h3>
          <p class="muted">${escapeHtml(aiProviderLabel(result.provider))} · ${escapeHtml(result.model || "")}${
            result.cached ? " · 缓存" : ""
          }</p>
        </div>
      </div>
      <details class="ai-result-fold" open>
        <summary class="ai-result-fold-summary">
          <span class="ai-result-fold-headline">${escapeHtml(headline)}</span>
        </summary>
        <div class="ai-result-fold-body">
          ${sectionsHtml(proposal)}
          ${adjustmentsHtml}
          ${listBlock("后续观察", proposal.watch_items)}
          ${listBlock("数据限制", proposal.data_limitations)}
          <p class="muted ai-review-disclaimer">${escapeHtml(result.disclaimer || "")}</p>
        </div>
      </details>
    </section>`;
}

import { state } from "../state.js";
import { escapeHtml } from "../utils.js";
import { RESEARCH_LABELS, researchRequest, researchResultIsStale } from "../portfolio-research.js";

import { runStrategyReplay, replayDataRequirements } from "../strategy-replay.js";

const pct = (value) => Number.isFinite(value) ? `${value.toFixed(1)}%` : "暂无数据";
let research = null;
let controller = null;
let replay = null;
let replayImportId = 0;

function downloadJson(value, name, compact = false) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, compact ? 0 : 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function replayHtml(result) {
  if (result.status !== "ready") return `<p class="research-goal-note">完整策略历史不足，未计算收益。</p><ul>${(result.reasons || []).map(r => `<li>${escapeHtml(r)}</li>`).join("")}</ul>`;
  return `<p class="research-goal-note">历史包回放完成。结果来自导入包内固定计划，不代表当前工作区配置已验证。</p>
    <table class="goal-table"><thead><tr><th scope="col">策略</th><th scope="col">全期年化</th><th scope="col">后 30% 留出年化</th><th scope="col">日度最大回撤</th><th scope="col">佣金 / 滑点成本</th></tr></thead><tbody>${result.strategies.map(s => `<tr><th scope="row">${s.id === "configured" ? "包内配置策略" : "固定倍率同源基准"}</th><td>${pct(s.annualized_return_pct)}</td><td>${pct(s.holdout.annualized_return_pct)}</td><td>${pct(s.max_drawdown_pct)}</td><td>¥${s.fees.toFixed(2)} / ¥${s.slippage_cost.toFixed(2)}</td></tr>`).join("")}</tbody></table>
    <p class="muted">时间留出段 ${escapeHtml(result.strategies[0].holdout.start)} 至 ${escapeHtml(result.strategies[0].holdout.end)}。固定倍率基准保留相同卖出纪律。未自动优化参数，亦非前瞻样本外验证。</p>
    <details open><summary>回放假设与边界</summary><ul>${result.limitations.map(r => `<li>${escapeHtml(r)}</li>`).join("")}</ul></details>`;
}

function resultsHtml(result) {
  if (["invalid_request", "busy", "request_too_large"].includes(result.status)) return `<p class="research-goal-note">${(result.limitations || []).map(escapeHtml).join("；")}</p>`;
  const targetLabel = Number.isFinite(result.goal?.annual_return_target_pct) ? `达到 ${pct(result.goal.annual_return_target_pct)} 目标` : "目标未设置";
  const coverage = `<h4>历史覆盖</h4><p class="muted">仅使用截至 ${escapeHtml(result.cutoff || "未知")} 的完整月份，共同月度观测 ${result.observations ?? 0} 个。</p>
    <table class="goal-table research-coverage"><thead><tr><th scope="col">ETF / 来源</th><th scope="col">月份数</th><th scope="col">历史区间</th></tr></thead><tbody>${(result.coverage || []).map((row) => `<tr><th scope="row">${escapeHtml(row.symbol)}<small>${escapeHtml(row.provider)}</small></th><td>${row.months}</td><td>${escapeHtml(row.start || "无数据")}<br>${escapeHtml(row.end || "")}</td></tr>${row.error || row.invalid_rows || row.conflicting_dates ? `<tr><td colspan="3" class="research-data-note">${escapeHtml(row.error || `无效记录 ${row.invalid_rows} 条，冲突日期 ${row.conflicting_dates} 个`)}</td></tr>` : ""}`).join("")}</tbody></table>`;
  const strategies = result.strategies || [];
  const comparisons = strategies.length ? `<h4>相同入金与费用下的基准比较</h4><p class="muted">${escapeHtml(result.start)} 至 ${escapeHtml(result.end)} · 月投 ¥${Number(result.monthly_budget).toLocaleString("zh-CN")} · 每个窗口从空仓开始</p>
    <table class="goal-table research-comparison"><thead><tr><th scope="col">基准</th><th scope="col">策略年化</th><th scope="col">XIRR</th><th scope="col">月度最大回撤</th></tr></thead><tbody>${strategies.map((row) => `<tr><th scope="row">${RESEARCH_LABELS[row.id] || escapeHtml(row.id)}</th><td>${pct(row.annualized_return_pct)}</td><td>${pct(row.money_weighted_return_pct)}</td><td>${pct(row.max_drawdown_pct)}</td></tr>`).join("")}</tbody></table>
    <p class="muted">策略年化剔除入金影响并扣除模拟交易费用；XIRR 按入金时间计量。月度回撤可能漏掉月内深跌。</p>
    ${strategies.map((row) => `<details class="research-rolling"><summary>${RESEARCH_LABELS[row.id] || escapeHtml(row.id)}：滚动窗口</summary><p class="muted">模拟累计本金 ¥${row.contributed_capital.toLocaleString("zh-CN")} · 净盈亏 ¥${row.net_profit.toLocaleString("zh-CN")} · 交易费用 ¥${row.fees.toLocaleString("zh-CN")}</p>
      <table class="goal-table"><thead><tr><th scope="col">窗口 / 样本数</th><th scope="col">历史年化范围</th><th scope="col">${targetLabel}</th></tr></thead><tbody>${row.rolling.map((window) => `<tr><th scope="row">${window.horizon_months / 12} 年<small>${window.count} 个重叠窗口</small></th>${window.status === "ready" ? `<td>${pct(window.min_return_pct)} 至 ${pct(window.max_return_pct)}<small>中位 ${pct(window.median_return_pct)}</small></td><td>${pct(window.target_hit_pct)}</td>` : `<td colspan="2">历史不足<small>需要 ${window.required_observations} 个观测，现有 ${window.available_observations} 个</small></td>`}</tr>`).join("")}</tbody></table></details>`).join("")}` : "";
  const goalStatus = result.goal_horizon_status === "insufficient_history" ? "当前历史不足以覆盖你填写的投资期限。"
    : result.goal_horizon_status === "historical_only" ? "已计算目标期限的历史窗口，未来达标能力尚未验证。"
    : "填写并保存投资目标后，可比较对应期限与年化目标。";
  return `${coverage}${comparisons}<p class="research-goal-note">${goalStatus}</p><details class="research-limits" open><summary>研究边界与数据限制</summary><ul>${(result.limitations || []).map((text) => `<li>${escapeHtml(text)}</li>`).join("")}</ul></details>`;
}

export function renderPortfolioResearch() {
  const root = document.querySelector("#portfolioResearchPanel");
  if (!root) return;
  if (!root.querySelector("form")) {
    root.innerHTML = `<div class="plan-section-heading"><h3 class="plan-section-title">长期历史研究</h3><span class="goal-status-label">价格基准研究</span></div>
      <p class="muted">检查当前目标权重在不同历史起点的表现。使用 ETF 自身历史，缺少数据时显示缺口。</p>
      <form class="research-form"><label>月度研究预算（元）<input type="number" name="budget" min="1" max="100000000" step="1" required placeholder="仅用于研究，不修改定投计划" /></label><button type="submit" class="primary-button">获取历史并比较</button><button type="button" class="ghost-button" data-research-cancel hidden>取消</button><button type="button" class="ghost-button" data-research-export hidden>导出研究 JSON</button></form>
      <p class="muted research-status" role="status">尚未运行。使用当前目标权重与交易费用；按月研究，独立于实际执行频率。</p><div data-research-result></div>
      <details class="research-limits"><summary>完整策略回放与时间留出验证</summary><p class="muted">当前价格接口缺少原时点策略数据，无法直接验证完整策略。导入历史包后可复用实际交易规划；不修改持仓或计划。</p><ul>${replayDataRequirements().map(r => `<li>${escapeHtml(r)}</li>`).join("")}</ul>
      <p><a href="/docs/STRATEGY_REPLAY.md" target="_blank" rel="noopener">历史包格式与计算方法</a></p>
      <label>导入历史 JSON（最多 20 MB）<input type="file" accept=".json,application/json" data-replay-file /></label><button type="button" class="ghost-button" data-replay-export hidden>导出可重放历史</button><button type="button" class="ghost-button" data-replay-report hidden>导出回放报告</button>
      <p role="status" data-replay-status>尚未导入，完整策略验证不可用。</p><div data-replay-result></div></details>`;
    root.querySelector("[data-replay-file]").addEventListener("change", async (event) => {
      const file = event.target.files?.[0]; if (!file) return;
      const importId = ++replayImportId;
      const status = root.querySelector("[data-replay-status]");
      status.textContent = "正在校验历史包并回放…";
      try {
        if (file.size > 20 * 1024 * 1024) throw new Error("too_large");
        const parsed = JSON.parse(await file.text());
        if (importId !== replayImportId) return;
        const input = parsed.input || parsed;
        if (new Blob([JSON.stringify(input)]).size > 20 * 1024 * 1024) throw new Error("too_large");
        const result = runStrategyReplay(input);
        replay = { input, result };
        root.querySelector("[data-replay-result]").innerHTML = replayHtml(result);
        root.querySelector("[data-replay-export]").hidden = false;
        root.querySelector("[data-replay-report]").hidden = false;
        status.textContent = result.status === "ready" ? "历史包回放完成，未修改工作区。" : "历史包缺少必要数据，未输出收益。";
      } catch {
        if (importId !== replayImportId) return;
        replay = null; root.querySelector("[data-replay-export]").hidden = true;
        root.querySelector("[data-replay-report]").hidden = true;
        root.querySelector("[data-replay-result]").textContent = "";
        status.textContent = "无法读取：请选择不超过 20 MB 的有效 JSON 历史包。";
      }
    });
    root.querySelector("[data-replay-export]").addEventListener("click", () => { if (replay) downloadJson(replay.input, "strategy-replay-history.json", true); });
    root.querySelector("[data-replay-report]").addEventListener("click", () => { if (replay) downloadJson(replay.result, "strategy-replay-report.json"); });
    const form = root.querySelector("form");
    form.elements.budget.value = state.plan?.cadence === "monthly" && state.plan?.amount > 0 ? Math.round(state.plan.amount) : "";
    form.elements.budget.addEventListener("input", () => {
      root.dataset.budgetEdited = "true";
      renderPortfolioResearch();
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (controller || !form.reportValidity()) return;
      const request = researchRequest(state.etfs, state.plan, form.elements.budget.value);
      const active = new AbortController();
      controller = active;
      research = { request, result: null, message: "正在获取历史并计算。行情接口可能需要一至三分钟…" };
      renderPortfolioResearch();
      const timeout = setTimeout(() => active.abort(), 180000);
      try {
        const response = await fetch("/api/strategy/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: active.signal });
        const result = await response.json();
        if (!response.ok && !["insufficient_history", "invalid_request", "busy", "request_too_large"].includes(result.status)) throw new Error("研究服务暂不可用");
        const message = result.status === "ready" ? "历史比较完成，结果不代表未来收益。"
          : result.status === "invalid_request" ? "研究参数需要调整。"
          : ["busy", "request_too_large"].includes(result.status) ? (result.limitations?.[0] || "研究服务繁忙，请稍后重试。")
          : "历史不足，暂不输出组合收益。";
        research = { request, result, message };
      } catch (error) {
        research = { request, result: null, message: active.signal.aborted ? "研究已取消或超时，可重新运行。" : "历史研究请求失败，请检查本地服务后重试。" };
      } finally {
        clearTimeout(timeout);
        controller = null;
        renderPortfolioResearch();
      }
    });
    root.querySelector("[data-research-cancel]").addEventListener("click", () => controller?.abort());
    root.querySelector("[data-research-export]").addEventListener("click", () => {
      if (!research?.result) return;
      const result = research.result;
      const blob = new Blob([JSON.stringify({ request: { ...research.request, price_history: result.price_history }, result }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `portfolio-research-${result.cutoff || "result"}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  if (!research && root.dataset.budgetEdited !== "true") {
    root.querySelector('[name="budget"]').value = state.plan?.cadence === "monthly" && state.plan?.amount > 0 ? Math.round(state.plan.amount) : "";
  }
  root.querySelector('[type="submit"]').disabled = Boolean(controller);
  root.querySelector("[data-research-cancel]").hidden = !controller;
  root.querySelector("[data-research-export]").hidden = !research?.result?.price_history;
  if (research) {
    const stale = researchResultIsStale(research.request, state.etfs, state.plan, root.querySelector('[name="budget"]').value);
    root.querySelector('[role="status"]').textContent = stale ? "配置已变化，下方属于上次请求，请重新运行。" : research.message;
    root.querySelector('[role="status"]').classList.toggle("research-stale", stale);
    if (root._researchResult !== research.result) {
      root.querySelector("[data-research-result]").innerHTML = research.result ? resultsHtml(research.result) : "";
      root._researchResult = research.result;
    }
  }
}

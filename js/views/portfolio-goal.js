import { appConfig, state } from "../state.js";
import { assessPortfolioGoal, normalizeInvestmentGoal } from "../portfolio-goal.js";
import { escapeHtml } from "../utils.js";
import { persistWorkspace } from "../workspace.js";
import { callRenderer } from "./render.js";
import { reevaluatePeriodStrategy } from "../execution-drafts.js";
import { renderPortfolioResearch } from "./portfolio-research.js";

const pct = (value) => value == null ? "暂无数据" : `${value.toFixed(1)}%`;
const FIELDS = ["annual_return_target_pct", "horizon_years", "max_drawdown_pct", "single_index_warn_pct", "liquidity_need"];

function goalFormHtml() {
  return `<details class="goal-editor" open>
    <summary>编辑投资目标</summary>
    <form class="goal-form" aria-label="投资目标" autocomplete="off">
      <label><span>人民币年化目标（%）</span><input name="annual_return_target_pct" type="number" min="0" max="100" step="0.1" placeholder="例如 10" /></label>
      <label><span>投资期限（年）</span><input name="horizon_years" type="number" min="1" max="60" step="0.5" placeholder="例如 10" /></label>
      <label><span>可承受回撤（%）</span><input name="max_drawdown_pct" type="number" min="0" max="100" step="1" placeholder="请按自身情况填写" /></label>
      <label><span>单一指数集中提示线（%，可选）</span><input name="single_index_warn_pct" type="number" min="1" max="100" step="1" placeholder="不填写则仅展示占比" /></label>
      <label class="goal-liquidity"><span>这笔资金的用途</span><select name="liquidity_need"><option value="unknown">尚未确定</option><option value="long_term">长期投资，近期不使用</option><option value="within_3_years">三年内可能使用</option></select></label>
      <div class="goal-form-actions"><button class="primary-button" type="submit">保存目标</button><button class="ghost-button" type="button" data-goal-cancel>撤销未保存修改</button></div>
      <p class="muted goal-form-status" data-goal-form-status role="status"></p>
    </form>
  </details>`;
}

function fillGoalForm(root) {
  const goal = normalizeInvestmentGoal(state.plan?.investment_goal);
  const form = root.querySelector("form");
  for (const key of FIELDS) form.elements.namedItem(key).value = goal[key] ?? "";
}

function initializePanel(root) {
  root.innerHTML = `<div class="plan-section-heading"><h3 class="plan-section-title">目标与组合风险</h3><span class="goal-status-label" data-goal-status></span></div>
    <p class="muted goal-intro">将收益目标与期限、亏损承受能力一起检查。目标不代表预期收益。</p>
    <div data-goal-overview></div>
    ${goalFormHtml()}
    <div data-goal-exposure></div>
    <div data-goal-warnings></div>
    <div class="goal-strategy-note"><div><strong>优先用新增资金再平衡</strong><p class="muted">按投入后的目标金额补足低配资产，减少为调仓而卖出。交易仍受溢价、整手和费用约束。</p></div><button type="button" class="ghost-button" data-goal-rebalance>使用现金流再平衡</button></div>`;
  fillGoalForm(root);
  const form = root.querySelector("form");
  const status = root.querySelector("[data-goal-form-status]");
  const markDirty = () => {
    root.dataset.dirty = "true";
    status.textContent = "有未保存修改，行情刷新不会覆盖输入。";
  };
  form.addEventListener("input", markDirty);
  form.addEventListener("change", markDirty);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const investmentGoal = normalizeInvestmentGoal(Object.fromEntries(FIELDS.map((key) => [key, form.elements.namedItem(key).value])));
    state.plan = { ...state.plan, investment_goal: investmentGoal };
    root.dataset.dirty = "false";
    status.textContent = "正在保存目标…";
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    renderPortfolioGoalPanels();
    try {
      await persistWorkspace({ immediate: true });
      if (root.dataset.dirty !== "true") status.textContent = state.workspaceSync.status === "synced"
        ? "目标已保存。回撤与集中提示线用于诊断，不会自动止损或调仓。"
        : "目标已保存在浏览器，服务器同步失败，可再次保存重试。";
    } catch {
      status.textContent = "目标保存失败，请重试。";
    } finally {
      button.disabled = false;
    }
  });
  root.querySelector("[data-goal-cancel]").addEventListener("click", () => {
    fillGoalForm(root);
    root.dataset.dirty = "false";
    status.textContent = "已恢复已保存的目标。";
  });
  root.querySelector("[data-goal-rebalance]").addEventListener("click", () => {
    state.plan = { ...state.plan, strategy: "rebalance" };
    reevaluatePeriodStrategy();
    callRenderer("renderEtfPool");
    persistWorkspace();
  });
}

function allocationRowsHtml(groups) {
  return groups.filter((group) => group.target > 0 || group.current > 0).map((group) => `<tr>
    <th scope="row">${escapeHtml(group.label)}</th><td>${pct(group.current)}</td><td>${pct(group.target)}</td>
  </tr>`).join("");
}

export function renderPortfolioGoalPanels() {
  renderPortfolioResearch();
  const support = appConfig?.etf?.analysis_support || {};
  const mapped = appConfig?.etf?.analysis_registry || {};
  const registry = Object.fromEntries([...new Set([...Object.keys(support), ...Object.keys(mapped)])]
    .map((symbol) => [symbol, { ...support[symbol], ...mapped[symbol] }]));
  const assessment = assessPortfolioGoal({ etfs: state.etfs, quotes: state.quotesBySymbol, registry, goal: state.plan?.investment_goal });
  const goal = assessment.goal;
  const goalLabel = goal.annual_return_target_pct == null ? "待设置" : `${goal.annual_return_target_pct}%`;
  const statusLabel = !assessment.configured ? "目标信息待补全" : assessment.warnings.length ? "有待复核事项" : "收益目标尚未验证";
  const root = document.querySelector("#portfolioGoalPanel");
  if (root) {
    if (!root.querySelector("form")) initializePanel(root);
    if (root.dataset.dirty !== "true" && !root.querySelector("form").contains(document.activeElement)) fillGoalForm(root);
    root.querySelector("[data-goal-status]").textContent = statusLabel;
    root.querySelector("[data-goal-overview]").innerHTML = `<dl class="goal-overview">
      <div><dt>年化目标</dt><dd>${escapeHtml(goalLabel)}</dd></div>
      <div><dt>投资期限</dt><dd>${goal.horizon_years == null ? "待设置" : `${goal.horizon_years} 年`}</dd></div>
      <div><dt>回撤承受值</dt><dd>${goal.max_drawdown_pct == null ? "待设置" : `${goal.max_drawdown_pct}%`}</dd></div>
    </dl>`;
    root.querySelector("[data-goal-exposure]").innerHTML = assessment.rows.length ? `<div class="goal-exposure-heading"><h4>配置结构</h4><span class="muted">ETF 池内占比，不含账户外资金与现金池</span></div>
      <div class="goal-exposure-grid"><table class="goal-table"><caption>资产类别</caption><thead><tr><th scope="col">类别</th><th scope="col">当前</th><th scope="col">目标</th></tr></thead><tbody>${allocationRowsHtml(assessment.assets)}</tbody></table>
      <table class="goal-table"><caption>股票市场与其他资产</caption><thead><tr><th scope="col">市场 / 类别</th><th scope="col">当前</th><th scope="col">目标</th></tr></thead><tbody>${allocationRowsHtml(assessment.regions)}</tbody></table></div>
      <details class="goal-indices"><summary>按跟踪指数合并查看（${assessment.indices.length} 组）</summary><table class="goal-table"><thead><tr><th scope="col">指数 / ETF</th><th scope="col">当前</th><th scope="col">目标</th></tr></thead><tbody>${assessment.indices.map((group) => `<tr><th scope="row">${escapeHtml(group.name)}${group.known ? "" : "（映射待核对）"}<small>${escapeHtml(group.symbols.join(" / "))}</small></th><td>${pct(group.current)}</td><td>${pct(group.target)}</td></tr>`).join("")}</tbody></table></details>
      <div class="goal-stress"><strong>假设压力情景</strong><span>当前配置损失 ${pct(assessment.currentStress)} · 目标配置损失 ${pct(assessment.targetStress)}</span><p class="muted">假设股票下跌 45%、黄金 10%、债券 5%、其他商品 30%。仅用于检查承受能力，不是历史回撤、预测或最大损失上限。</p></div>`
      : `<p class="muted goal-empty">添加 ETF 并填写目标权重后，这里会显示组合结构与集中度。</p>`;
    root.querySelector("[data-goal-warnings]").innerHTML = assessment.warnings.length
      ? `<div class="goal-review"><h4>需要复核</h4><ul>${assessment.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul></div>` : "";
    const rebalance = root.querySelector("[data-goal-rebalance]");
    rebalance.disabled = state.plan?.strategy === "rebalance";
    rebalance.textContent = rebalance.disabled ? "已使用再平衡定投" : "使用现金流再平衡";
  }
  const home = document.querySelector("#homePortfolioGoal");
  if (home) {
    home.innerHTML = `<section class="panel-block goal-home" aria-label="投资目标检查"><div><h3>投资目标检查</h3><p>年化目标 ${escapeHtml(goalLabel)} · ${escapeHtml(statusLabel)}</p><p class="muted">股票占比 ${pct(assessment.assets.find((group) => group.id === "equity")?.current)} · 目标与历史收益分开评估</p></div><button type="button" class="ghost-button" data-open-goal>查看目标与风险</button></section>`;
    home.querySelector("[data-open-goal]").addEventListener("click", () => {
      callRenderer("switchView", "etf");
      document.querySelector("#etfTabGoal")?.click();
      root?.scrollIntoView({ block: "start" });
    });
  }
}

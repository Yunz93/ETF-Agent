import { lookThroughPortfolio, portfolioStressScenarios } from "./portfolio-risk.js";

/** 投资目标和组合结构诊断。所有收益目标与压力情景均不作为收益预测。 */

function optionalNumber(value, min, max) {
  if (value == null || (typeof value === "string" && !value.trim()) || typeof value === "boolean" || typeof value === "object") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return null;
  return Math.round(number * 100) / 100;
}

export function normalizeInvestmentGoal(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    currency: "CNY",
    account_cash: optionalNumber(source.account_cash, 0, 1e12),
    account_debt: optionalNumber(source.account_debt, 0, 1e12),
    near_term_cash_need: optionalNumber(source.near_term_cash_need, 0, 1e12),
    annual_return_target_pct: optionalNumber(source.annual_return_target_pct, 0, 100),
    horizon_years: optionalNumber(source.horizon_years, 1, 60),
    max_drawdown_pct: optionalNumber(source.max_drawdown_pct, 0, 100),
    single_index_warn_pct: optionalNumber(source.single_index_warn_pct, 1, 100),
    liquidity_need: ["long_term", "within_3_years"].includes(source.liquidity_need)
      ? source.liquidity_need : "unknown",
  };
}

export function hasInvestmentGoal(value) {
  const goal = normalizeInvestmentGoal(value);
  return Object.entries(goal).some(([key, value]) => key !== "currency" &&
    (key === "liquidity_need" ? value !== "unknown" : value != null));
}

export const ASSET_LABELS = Object.freeze({
  equity: "股票", gold: "黄金", bond: "债券", commodity: "其他商品", unknown: "待识别",
});
export const REGION_LABELS = Object.freeze({
  CN: "A 股", US: "美国", HK: "香港", other: "其他市场", non_equity: "非股票资产", unknown: "待识别",
});

// Registry identifiers, not ETF ticker guesses. Unknown exposures stay unknown.
const INDEX_EXPOSURES = Object.freeze({
  SPX: ["equity", "US", "broad"], NDX: ["equity", "US", "growth"],
  HSI: ["equity", "HK", "broad"], HSTECH: ["equity", "HK", "growth"],
  H30269: ["equity", "CN", "dividend"], "000922": ["equity", "CN", "dividend"],
  "000510": ["equity", "CN", "broad"], A500: ["equity", "CN", "broad"],
  "000300": ["equity", "CN", "broad"], "000905": ["equity", "CN", "broad"],
  "000852": ["equity", "CN", "broad"], "000016": ["equity", "CN", "broad"],
  "000688": ["equity", "CN", "growth"], "399006": ["equity", "CN", "growth"],
});

export function classifyExposure(entry, metadata = {}) {
  const indexCode = String(metadata.index_code || entry.indexCode || "").trim().toUpperCase();
  const known = INDEX_EXPOSURES[indexCode];
  if (known) return { indexCode, asset: known[0], region: known[1], style: known[2] };
  const assetClass = metadata.asset_class || entry.assetClass || "";
  const name = `${metadata.index_name || ""} ${metadata.etf_name || ""} ${entry.name || ""}`;
  let asset = "unknown";
  if (/黄金/.test(name)) asset = "gold";
  else if (assetClass === "bond") asset = "bond";
  else if (assetClass === "commodity") asset = "commodity";
  else if (["equity", "equity_core", "equity_growth", "dividend"].includes(assetClass)) asset = "equity";
  const region = ["gold", "bond", "commodity"].includes(asset) ? "non_equity"
    : ["CN", "US", "HK", "other"].includes(metadata.region) ? metadata.region : "unknown";
  return { indexCode, asset, region, style: assetClass === "dividend" ? "dividend" : "unknown" };
}

const STRESS_LOSSES = Object.freeze({ equity: 45, gold: 10, bond: 5, commodity: 30 });

export function assessPortfolioGoal({ etfs = [], quotes = {}, registry = {}, goal = null, plan = {}, disclosures = {}, today = new Date() } = {}) {
  const normalizedGoal = normalizeInvestmentGoal(goal);
  const rows = etfs.map((entry) => {
    const metadata = registry[entry.symbol] || {};
    const shares = Math.max(0, Number(entry.shares) || 0);
    const price = Number(quotes[entry.symbol]?.price);
    const missingPrice = shares > 0 && !(Number.isFinite(price) && price > 0);
    return {
      symbol: entry.symbol, name: entry.name || entry.symbol,
      indexName: metadata.index_name || metadata.index_full_name || entry.name || entry.symbol,
      ...classifyExposure(entry, metadata),
      target: Math.max(0, Number(entry.target_weight) || 0),
      value: missingPrice ? null : shares > 0 ? shares * price : 0,
      missingPrice,
    };
  });
  const totalValue = rows.reduce((sum, row) => sum + (row.value || 0), 0);
  const targetSum = rows.reduce((sum, row) => sum + row.target, 0);
  const pricesComplete = rows.every((row) => !row.missingPrice);
  const currentAvailable = pricesComplete && totalValue > 0;
  const targetAvailable = Math.abs(targetSum - 100) < 0.01;
  const groups = (key, labels) => Object.entries(labels).map(([id, label]) => ({
    id, label,
    current: currentAvailable ? rows.filter((row) => row[key] === id).reduce((sum, row) => sum + row.value, 0) / totalValue * 100 : null,
    target: rows.filter((row) => row[key] === id).reduce((sum, row) => sum + row.target, 0),
  }));
  const assets = groups("asset", ASSET_LABELS);
  const regions = groups("region", REGION_LABELS);
  const byIndex = new Map();
  for (const row of rows) {
    const key = row.indexCode || `unknown:${row.symbol}`;
    if (!byIndex.has(key)) byIndex.set(key, { code: key, name: row.indexName, known: Boolean(row.indexCode), symbols: [], value: 0, target: 0 });
    const group = byIndex.get(key);
    group.symbols.push(row.symbol);
    group.value += row.value || 0;
    group.target += row.target;
  }
  const indices = [...byIndex.values()].map((group) => ({
    ...group, current: currentAvailable ? group.value / totalValue * 100 : null,
  })).sort((a, b) => (b.current ?? b.target) - (a.current ?? a.target));
  const stress = (basis, available) => {
    if (!available || assets.some((group) => group.id === "unknown" && group[basis] > 0)) return null;
    return assets.reduce((sum, group) => sum + (group[basis] || 0) * (STRESS_LOSSES[group.id] || 0) / 100, 0);
  };
  const scenarios = portfolioStressScenarios(rows, { currentAvailable, targetAvailable, totalValue, goal: normalizedGoal,
    initialTargetPct: optionalNumber(plan.initial_target_pct, 0, 100) });
  const lookthrough = lookThroughPortfolio(rows, disclosures, today);
  const currentStress = stress("current", currentAvailable);
  const targetStress = stress("target", targetAvailable);
  const warnings = [];
  if (normalizedGoal.account_cash == null || normalizedGoal.account_debt == null) warnings.push("请填写本账户现金余额（含现金池）和负债（无负债填0），才能评估账户损失；资金基数不能代替实时余额。");
  if (normalizedGoal.account_cash != null && normalizedGoal.account_debt != null && currentAvailable && totalValue + normalizedGoal.account_cash <= normalizedGoal.account_debt) warnings.push("本账户净资产非正，不能计算百分比压力损失，请核对负债。");
  if (normalizedGoal.near_term_cash_need != null && normalizedGoal.account_cash != null && normalizedGoal.near_term_cash_need > normalizedGoal.account_cash) warnings.push("近期用款超过账户现金，请先核对资金安排。");
  if (lookthrough.known != null && lookthrough.known < 99.99) warnings.push(`底层持仓披露覆盖目标组合 ${lookthrough.known.toFixed(1)}%，其余暴露未知，不能据此宣称充分分散。`);
  const minCommission = Number(plan.trading_cost?.min_commission);
  const feeLimit = Number(plan.trading_cost?.max_fee_ratio_pct);
  const efficientAmount = minCommission > 0 && feeLimit > 0 ? minCommission / (feeLimit / 100) : null;
  const smallOrders = efficientAmount && plan.amount > 0 ? rows.filter((row) => row.target > 0 && plan.amount * row.target / 100 < efficientAmount) : [];
  if (smallOrders.length) warnings.push(`当前费用约束要求单笔约 ${Math.ceil(efficientAmount).toLocaleString("zh-CN")} 元起，${smallOrders.length} 只 ETF 按权重分配的单期额度不足。等待资金累计或减少下单次数，整手与实际费用仍以执行页为准。`);
  if (!targetAvailable && rows.length) warnings.push(`目标权重合计 ${targetSum.toFixed(1)}%，请在持仓管理中调整至 100%。`);
  if (!pricesComplete) warnings.push("部分持仓缺少有效报价，当前占比与压力损失暂不计算。");
  if (assets.some((group) => group.id === "unknown" && (group.target > 0 || group.current > 0))) {
    warnings.push("部分资产类别尚未识别，不能完整评估组合风险。");
  }
  for (const scenario of scenarios) {
    for (const [label, loss, basis] of [
      ["当前配置", scenario.accountCurrent ?? scenario.current, scenario.accountCurrent != null ? "账户净资产" : "ETF池，尚未计现金"],
      ["目标配置", scenario.accountTarget ?? scenario.target, scenario.accountTarget != null ? "初期ETF投入比例，其余假设现金" : "ETF池"],
    ]) {
      if (normalizedGoal.max_drawdown_pct != null && loss != null && loss > normalizedGoal.max_drawdown_pct) warnings.push(`${label}在假设情景「${scenario.label}」中损失 ${loss.toFixed(1)}%，超过你填写的 ${normalizedGoal.max_drawdown_pct}% 回撤承受值（${basis}口径）。`);
    }
  }
  if (normalizedGoal.liquidity_need === "within_3_years" && assets.find((group) => group.id === "equity")?.target > 0) {
    warnings.push("这笔资金三年内可能使用，请先分离近期用款，再确定股票配置。");
  }
  if (normalizedGoal.annual_return_target_pct >= 10 && normalizedGoal.horizon_years != null && normalizedGoal.horizon_years < 10) {
    warnings.push("当前期限不足十年，10% 及以上的年化目标需要结合亏损承受能力重新评估。");
  }
  const concentrationLimit = normalizedGoal.single_index_warn_pct;
  if (concentrationLimit != null) {
    for (const group of indices) {
      if ((group.current != null && group.current > concentrationLimit) || group.target > concentrationLimit) {
        warnings.push(`${group.name} 的当前或目标占比超过 ${concentrationLimit}% 集中提示线。`);
      }
    }
  }
  if (byIndex.has("SPX") && byIndex.has("NDX")) {
    const target = byIndex.get("SPX").target + byIndex.get("NDX").target;
    warnings.push(`标普与纳指目标合计 ${target.toFixed(1)}%。两者存在成份重叠；此处未计算底层股票的准确重叠比例。`);
  }
  const configured = [normalizedGoal.annual_return_target_pct, normalizedGoal.horizon_years, normalizedGoal.max_drawdown_pct].every((value) => value != null);
  return {
    goal: normalizedGoal, configured, rows, assets, regions, indices,
    totalValue, targetSum, pricesComplete, currentAvailable, targetAvailable,
    currentStress, targetStress, warnings, scenarios, lookthrough, efficientAmount,
    status: !configured ? "incomplete" : warnings.length ? "review" : "unverified",
  };
}

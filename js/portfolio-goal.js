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

export function assessPortfolioGoal({ etfs = [], quotes = {}, registry = {}, goal = null } = {}) {
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
  const currentStress = stress("current", currentAvailable);
  const targetStress = stress("target", targetAvailable);
  const warnings = [];
  if (!targetAvailable && rows.length) warnings.push(`目标权重合计 ${targetSum.toFixed(1)}%，请在持仓管理中调整至 100%。`);
  if (!pricesComplete) warnings.push("部分持仓缺少有效报价，当前占比与压力损失暂不计算。");
  if (assets.some((group) => group.id === "unknown" && (group.target > 0 || group.current > 0))) {
    warnings.push("部分资产类别尚未识别，不能完整评估组合风险。");
  }
  for (const [label, loss] of [["当前配置", currentStress], ["目标配置", targetStress]]) {
    if (normalizedGoal.max_drawdown_pct != null && loss != null && loss > normalizedGoal.max_drawdown_pct) {
      warnings.push(`${label}在假设情景中损失 ${loss.toFixed(1)}%，超过你填写的 ${normalizedGoal.max_drawdown_pct}% 回撤承受值。`);
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
    currentStress, targetStress, warnings,
    status: !configured ? "incomplete" : warnings.length ? "review" : "unverified",
  };
}

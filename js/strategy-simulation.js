export const SIMULATION_LABELS = Object.freeze({ periodic: "周期定投", dip: "逢低加仓" });

export function simulationWeights(etfs, quotes, basis) {
  if (basis === "holdings") {
    const held = etfs.filter(e => Number(e.shares) > 0);
    if (!held.length) throw new Error("当前没有持仓，请选择目标比例。");
    if (held.some(e => !(Number(quotes[e.symbol]?.price) > 0) || !Number.isFinite(Number(quotes[e.symbol]?.price)) || !Number.isFinite(Number(e.shares)))) {
      throw new Error("部分持仓缺少有效行情，暂时无法计算持仓比例。请刷新行情或选择目标比例。");
    }
    const total = held.reduce((sum, e) => sum + Number(e.shares) * Number(quotes[e.symbol].price), 0);
    return Object.fromEntries(held.map(e => [e.symbol, Number(e.shares) * Number(quotes[e.symbol].price) / total * 100])
      .sort(([a], [b]) => a.localeCompare(b)));
  }
  const active = etfs.filter(e => Number(e.target_weight) > 0);
  if (!active.length || Math.abs(active.reduce((sum, e) => sum + Number(e.target_weight), 0) - 100) >= 0.01) {
    throw new Error("请先在持仓管理中把目标比例设为合计 100%，或选择当前持仓比例。");
  }
  return Object.fromEntries(active.map(e => [e.symbol, Number(e.target_weight)]).sort(([a], [b]) => a.localeCompare(b)));
}

export function simulationRequest(etfs, quotes, plan, values) {
  return {
    target_weights: simulationWeights(etfs, quotes, values.basis),
    budget: Number(values.budget), cadence: values.cadence, dip_pct: Number(values.dip_pct),
    years: Number(values.years), initial_cash: Number(values.initial_cash || 0),
    trading_cost: { lot_size: plan.trading_cost?.lot_size ?? 100,
      min_commission: plan.trading_cost?.min_commission ?? 5,
      commission_rate_pct: plan.trading_cost?.commission_rate_pct ?? 0.03,
      max_fee_ratio_pct: plan.trading_cost?.max_fee_ratio_pct ?? 0.25 },
  };
}

export function comparisonText(periodic, dip) {
  const difference = dip.net_profit - periodic.net_profit;
  if (Math.abs(difference) < 0.01) return "这段历史里，两种方式的净收益相同。";
  const winner = difference > 0 ? "逢低加仓" : "周期定投";
  return `这段历史里，${winner}多赚 ¥${Math.abs(difference).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}。`;
}

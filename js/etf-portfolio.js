/**
 * ETF 池市值 / 行指标计算（无 DOM）。
 */

import { state } from "./state.js";
import { money, signed } from "./utils.js";

export function entryMetrics(entry, quotesBySymbol = state.quotesBySymbol) {
  const quote = quotesBySymbol?.[entry.symbol];
  const price = quote?.price;
  const shares = Math.max(0, Number(entry.shares) || 0);
  const cost = Math.max(0, Number(entry.cost) || 0);
  // 有行情即参与统计：份额为 0 时市值 / 权重记 0，而不是缺省
  const value = price != null ? price * shares : null;
  // 成本未填（0）且已有份额时不把浮盈当成「全额盈利」
  const costValue =
    price != null && (cost > 0 || shares === 0) ? cost * shares : null;
  const pnl = value != null && costValue != null ? value - costValue : null;
  const pnlPct = pnl != null && costValue > 0 ? (pnl / costValue) * 100 : null;
  return { quote, price, value, costValue, pnl, pnlPct, shares, cost };
}

export function portfolioTotals(etfs = state.etfs, quotesBySymbol = state.quotesBySymbol) {
  let totalValue = 0;
  let totalCost = 0;
  let held = 0;
  let quoted = 0;
  (etfs || []).forEach((entry) => {
    const { value, costValue, shares } = entryMetrics(entry, quotesBySymbol);
    if (value != null) {
      totalValue += value;
      quoted += 1;
      if (shares > 0) held += 1;
    }
    if (costValue != null) totalCost += costValue;
  });
  return { totalValue, totalCost, held, quoted };
}

/** 概览首屏一行摘要，避免四张指标卡占满视口。 */
export function overviewGlanceLine({
  etfs = state.etfs,
  quotesBySymbol = state.quotesBySymbol,
  capitalBase = 0,
} = {}) {
  const { totalValue, totalCost, held, quoted } = portfolioTotals(etfs, quotesBySymbol);
  const pnl = totalCost ? totalValue - totalCost : null;
  const pnlPct = totalCost ? ((totalValue - totalCost) / totalCost) * 100 : null;
  const poolPct = capitalBase > 0 && totalValue > 0 ? (totalValue / capitalBase) * 100 : null;
  const bits = [`${(etfs || []).length} 只 · 持仓 ${held}`];
  if (quoted) bits.push(`市值 ${money(totalValue)}`);
  if (poolPct != null) bits.push(`池总仓 ${poolPct.toFixed(1)}%`);
  else if (capitalBase > 0) bits.push("池总仓 0%");
  if (pnl != null) {
    bits.push(`盈亏 ${money(pnl)}${pnlPct != null ? `（${signed(pnlPct, 1)}%）` : ""}`);
  }
  return bits.join(" · ");
}

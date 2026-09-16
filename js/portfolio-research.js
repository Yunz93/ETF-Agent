import { normalizeInvestmentGoal } from "./portfolio-goal.js";

export const RESEARCH_LABELS = Object.freeze({ fixed: "定额基准", cashflow: "现金流补缺基准", rebalance: "年度再平衡基准" });

export function researchRequest(etfs, plan, monthlyBudget) {
  return {
    target_weights: Object.fromEntries([...etfs]
      .filter((item) => Number(item.target_weight) > 0)
      .sort((a, b) => a.symbol.localeCompare(b.symbol))
      .map((item) => [item.symbol, Number(item.target_weight)])),
    monthly_budget: Number(monthlyBudget),
    trading_cost: { lot_size: plan.trading_cost?.lot_size ?? 100,
      min_commission: plan.trading_cost?.min_commission ?? 5,
      commission_rate_pct: plan.trading_cost?.commission_rate_pct ?? 0.03,
      max_fee_ratio_pct: plan.trading_cost?.max_fee_ratio_pct ?? 0.25 },
    investment_goal: normalizeInvestmentGoal(plan.investment_goal),
  };
}

export function researchFingerprint(request) {
  return JSON.stringify(request);
}

export function researchResultIsStale(request, etfs, plan, monthlyBudget) {
  return researchFingerprint(request) !== researchFingerprint(researchRequest(etfs, plan, monthlyBudget));
}

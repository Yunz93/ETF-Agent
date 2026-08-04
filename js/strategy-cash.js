/**
 * 现金池相关纯函数。
 */

export function computeCashRelease({ budget, cashReserve, poolBaseMult, preferTargetGap = false } = {}) {
  if (preferTargetGap) return 0;
  const totalBudget = Number(budget);
  const balance = Number(cashReserve);
  const W = Number(poolBaseMult);
  if (!(totalBudget > 0) || !(balance > 0) || !Number.isFinite(W)) return 0;
  let multiple = 0;
  if (W >= 1.4) multiple = 2;
  else if (W >= 1.2) multiple = 1;
  if (!(multiple > 0)) return 0;
  return Math.min(balance, Math.round(totalBudget * multiple));
}


/**
 * 估值定投倍率（按 PE 近十年分位网格）。
 * pePct: 0–1 近十年分位；无估值时退回评分档位。
 */
export function valuationDcaMultiplier({ pePct, grade } = {}) {
  if (pePct != null && Number.isFinite(Number(pePct))) {
    const p = Number(pePct);
    if (p <= 0.2) return { mult: 1.5, band: "低估区", hint: "PE 分位≤20%，可加大定投" };
    if (p <= 0.4) return { mult: 1.2, band: "偏低区", hint: "PE 分位 20%–40%，可略增" };
    if (p <= 0.6) return { mult: 1.0, band: "正常区", hint: "PE 分位 40%–60%，按计划定额" };
    if (p <= 0.8) return { mult: 0.5, band: "偏高区", hint: "PE 分位 60%–80%，减额定投" };
    return { mult: 0, band: "高估区", hint: "PE 分位>80%，暂停新增，等待回撤" };
  }
  const byGrade = {
    A: { mult: 1.5, band: "评分 A", hint: "综合评分偏乐观，可加大本期投入" },
    B: { mult: 1.2, band: "评分 B", hint: "较好买入区间，可按计划略增" },
    C: { mult: 1.0, band: "评分 C", hint: "中性区间，维持定额" },
    D: { mult: 0.5, band: "评分 D", hint: "偏贵或偏弱，减额定投" },
    E: { mult: 0, band: "评分 E", hint: "建议暂停新增" },
  };
  return byGrade[grade] || { mult: 1.0, band: "数据不足", hint: "估值与评分不足，先按中性参与" };
}

export function rebalanceHint({ targetWeight, actualWeight, name } = {}) {
  if (targetWeight == null || actualWeight == null) return null;
  const drift = actualWeight - targetWeight;
  if (Math.abs(drift) < 5) return null;
  const label = name || "该 ETF";
  if (drift > 0) return `${label} 高出目标 ${drift.toFixed(1)} pp，可少买`;
  return `${label} 低于目标 ${Math.abs(drift).toFixed(1)} pp，可优先补仓`;
}

function rebalanceFactor(targetWeight, actualWeight) {
  if (targetWeight == null || actualWeight == null) return 1;
  const drift = actualWeight - targetWeight;
  if (drift > 5) return 0.65;
  if (drift < -5) return 1.25;
  return 1;
}

/**
 * 全池定投分配。
 * - budget：整池每期总预算（不是单只 ETF）
 * - 某只不建议投（mult=0）时，其份额可让给其他可投品种
 * - 不强制投完：整体偏贵时只部署预算的一部分，剩余留现金
 * - 全部很差：部署 0
 *
 * holdings: [{ symbol, name, targetWeight, actualWeight, pePct, grade, analyzed }]
 */
export function allocatePoolBudget({ budget, holdings = [] } = {}) {
  const totalBudget = Number(budget);
  const empty = {
    budget: Number.isFinite(totalBudget) && totalBudget > 0 ? totalBudget : 0,
    deployTotal: 0,
    cashKeep: Number.isFinite(totalBudget) && totalBudget > 0 ? Math.round(totalBudget) : 0,
    deployFrac: 0,
    allocations: [],
    skipped: [],
  };
  if (!Number.isFinite(totalBudget) || totalBudget <= 0 || !holdings.length) return empty;

  const n = holdings.length;
  const hasTargets = holdings.some((item) => Number(item.targetWeight) > 0);
  const equal = 100 / n;

  const rows = holdings.map((item) => {
    const target = hasTargets
      ? Number(item.targetWeight) > 0
        ? Number(item.targetWeight)
        : 0
      : equal;
    const actual = item.actualWeight != null && Number.isFinite(Number(item.actualWeight)) ? Number(item.actualWeight) : null;
    const grid = valuationDcaMultiplier({ pePct: item.pePct, grade: item.grade });
    const reb = rebalanceFactor(target, actual);
    const score = (target / 100) * grid.mult * reb;
    return {
      symbol: item.symbol,
      name: item.name || item.symbol,
      targetWeight: target,
      actualWeight: actual,
      analyzed: item.analyzed !== false,
      ...grid,
      reb,
      score,
    };
  });

  const eligible = rows.filter((row) => row.score > 0 && row.mult > 0);
  const skipped = rows
    .filter((row) => row.mult <= 0 || row.score <= 0)
    .map((row) => ({
      symbol: row.symbol,
      name: row.name,
      band: row.band,
      reason: row.mult <= 0 ? "当期不建议新增" : "吸引力不足",
    }));

  if (!eligible.length) {
    return {
      ...empty,
      budget: Math.round(totalBudget),
      cashKeep: Math.round(totalBudget),
      skipped,
      note: "当期均偏弱，建议留现金。",
    };
  }

  // 仅在可投集合上衡量「该不该把预算打满」：可投越贵，部署比例越低；不强制投完
  const eligTargetSum = eligible.reduce((sum, row) => sum + row.targetWeight, 0) || eligible.length;
  const intensity =
    eligible.reduce((sum, row) => sum + (row.targetWeight / eligTargetSum) * row.mult * row.reb, 0) || 0;
  const deployFrac = Math.max(0, Math.min(1, intensity));
  const deployTotal = Math.round(totalBudget * deployFrac);

  const scoreSum = eligible.reduce((sum, row) => sum + row.score, 0) || 1;
  let allocated = 0;
  const allocations = eligible.map((row, index) => {
    let amount;
    if (index === eligible.length - 1) {
      amount = Math.max(0, deployTotal - allocated);
    } else {
      amount = Math.round((deployTotal * row.score) / scoreSum);
      allocated += amount;
    }
    return {
      symbol: row.symbol,
      name: row.name,
      amount,
      band: row.band,
      mult: row.mult,
      targetWeight: row.targetWeight,
      actualWeight: row.actualWeight,
      sharePct: deployTotal > 0 ? (amount / deployTotal) * 100 : 0,
      reason: row.hint,
    };
  });

  return {
    budget: Math.round(totalBudget),
    deployTotal,
    cashKeep: Math.round(totalBudget - deployTotal),
    deployFrac,
    allocations,
    skipped,
    note: deployFrac < 0.999 ? "未部署部分留现金" : "",
  };
}

export function allocationForSymbol(result, symbol) {
  if (!result) return null;
  return (result.allocations || []).find((item) => item.symbol === symbol) || null;
}

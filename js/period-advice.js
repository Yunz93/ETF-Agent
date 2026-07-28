/**
 * 本期执行结论：以定投策略分配结果为唯一「投 / 不投 / 投多少」来源。
 * 评分档位、盘面点评只作诊断背景，不另开买卖指令。
 */

import { state } from "./state.js";
import { money } from "./utils.js";
import {
  allocatePoolBudget,
  allocationForSymbol,
  dcaMultiplier,
  normalizeStrategyId,
  strategyLabel,
} from "./strategy.js";
import { buildPoolHoldingsForAllocation } from "./pool-alloc.js";

export const STANCE = Object.freeze({
  NEED_BUDGET: "need_budget",
  HOLD_CASH: "hold_cash",
  INVEST: "invest",
  SKIP: "skip",
});

function weightContext({ targetWeight, actualWeight } = {}) {
  if (targetWeight == null) return null;
  const targetText = `目标 ${Number(targetWeight).toFixed(1)}%`;
  if (actualWeight == null) return targetText;
  const drift = actualWeight - targetWeight;
  if (Math.abs(drift) < 5) {
    return `${targetText} · 实际 ${actualWeight.toFixed(1)}%`;
  }
  if (drift > 0) {
    return `${targetText} · 实际 ${actualWeight.toFixed(1)}%（高出 ${drift.toFixed(1)} pp）`;
  }
  return `${targetText} · 实际 ${actualWeight.toFixed(1)}%（低于 ${Math.abs(drift).toFixed(1)} pp）`;
}

/**
 * @param {{ symbol?: string, preferLive?: object|null, plan?: object, holdings?: array }} [opts]
 */
export function getPeriodAdvice({ symbol = "", preferLive = null, plan = null, holdings = null } = {}) {
  const activePlan = plan || state.plan || {};
  const strategy = normalizeStrategyId(activePlan.strategy);
  const strategyName = strategyLabel(strategy);
  const strategyConfig = activePlan.strategy_config;
  const budget = Number(activePlan.amount);
  const poolHoldings =
    holdings ||
    buildPoolHoldingsForAllocation({ preferLive: preferLive || null });
  const holding = poolHoldings.find((item) => item.symbol === symbol) || null;

  const grid = dcaMultiplier({
    strategy,
    strategyConfig,
    pePct: holding?.pePct,
    grade: holding?.grade,
  });

  const pool = allocatePoolBudget({
    budget,
    holdings: poolHoldings,
    strategy,
    strategyConfig,
  });
  const mine = symbol ? allocationForSymbol(pool, symbol) : null;
  const amount = mine?.amount ?? 0;
  const skipped = symbol
    ? (pool.skipped || []).find((item) => item.symbol === symbol) || null
    : null;

  let stance;
  let headline;
  let reason;
  if (!(budget > 0)) {
    stance = STANCE.NEED_BUDGET;
    headline = "先在定投计划设置「全池每期预算」";
    reason = "未设置全池预算，无法给出执行金额";
  } else if (pool.deployTotal <= 0) {
    stance = STANCE.HOLD_CASH;
    headline = "本期建议不投，保留现金";
    reason = pool.note || skipped?.reason || "当期均偏弱，建议留现金";
  } else if (amount > 0) {
    stance = STANCE.INVEST;
    headline = `本期建议投入 ${money(amount)}`;
    reason = mine?.reason || `${grid.band} · ${grid.mult}×`;
  } else {
    stance = STANCE.SKIP;
    headline = "本期本只不投";
    reason = skipped?.reason || "本期未分到额度";
  }

  const bullets = [`${strategyName} · ${grid.band} · ${grid.mult}×`];
  if (stance === STANCE.INVEST && mine) {
    bullets.push(`约占全池部署 ${mine.sharePct.toFixed(0)}%`);
  } else if (stance === STANCE.SKIP || stance === STANCE.HOLD_CASH) {
    bullets.push(reason);
  } else if (stance === STANCE.NEED_BUDGET) {
    bullets.push(reason);
  }

  const weightLine = weightContext({
    targetWeight: holding?.targetWeight > 0 ? holding.targetWeight : null,
    actualWeight: holding?.actualWeight,
  });
  if (weightLine) bullets.push(weightLine);

  if (holding?.pePct != null && Number.isFinite(Number(holding.pePct))) {
    bullets.push(`PE 分位约 ${Math.round(Number(holding.pePct) * 100)}%`);
  }

  const executionLine =
    stance === STANCE.NEED_BUDGET
      ? `本期执行：先设置全池预算（${strategyName}）`
      : stance === STANCE.HOLD_CASH
        ? `本期执行：全池不投，留现金（${strategyName} · ${grid.band}）`
        : stance === STANCE.INVEST
          ? `本期执行：投入 ${money(amount)}（${strategyName} · ${grid.band} · ${grid.mult}×）`
          : `本期执行：本只不投（${strategyName} · ${reason}）`;

  return {
    symbol,
    strategy,
    strategyName,
    stance,
    headline,
    reason,
    amount,
    mult: grid.mult,
    band: grid.band,
    hint: grid.hint,
    grade: holding?.grade || null,
    pePct: holding?.pePct ?? null,
    pool,
    mine,
    skipped,
    bullets,
    executionLine,
    canAdd: stance === STANCE.INVEST,
    playbookTriggers:
      stance === STANCE.NEED_BUDGET
        ? ["先设置全池预算"]
        : stance === STANCE.HOLD_CASH
          ? ["全池暂缓，留现金"]
          : stance === STANCE.INVEST
            ? [`本只用 ${money(amount)}`]
            : ["本只不投"],
  };
}

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
  POSITION_TOLERANCE_PP,
  STRATEGY_IDS,
  strategyLabel,
} from "./strategy.js";
import { buildPoolHoldingsForAllocation } from "./pool-alloc.js";
import { planExecutionContext } from "./decision-support.js";

export const STANCE = Object.freeze({
  NEED_BUDGET: "need_budget",
  HOLD_CASH: "hold_cash",
  INVEST: "invest",
  SKIP: "skip",
});

function resolveSymbolStrategy(plan, symbol) {
  const globalId = normalizeStrategyId(plan?.strategy);
  const overrides = plan?.strategy_overrides;
  const raw = overrides && typeof overrides === "object" ? overrides[symbol] : null;
  if (raw == null || raw === "") {
    return { strategy: globalId, overridden: false };
  }
  const id = String(raw || "").trim().toLowerCase();
  if (!STRATEGY_IDS.includes(id)) {
    return { strategy: globalId, overridden: false };
  }
  return { strategy: id, overridden: true };
}

/**
 * @param {{ symbol?: string, preferLive?: object|null, plan?: object, holdings?: array }} [opts]
 */
export function getPeriodAdvice({ symbol = "", preferLive = null, plan = null, holdings = null } = {}) {
  const activePlan = plan || state.plan || {};
  const { strategy, overridden } = resolveSymbolStrategy(activePlan, symbol);
  const strategyName = overridden
    ? `${strategyLabel(strategy)}(指定)`
    : strategyLabel(strategy);
  const strategyConfig = activePlan.strategy_config;
  const strategyOverrides = activePlan.strategy_overrides;
  const poolHoldings =
    holdings ||
    buildPoolHoldingsForAllocation({ preferLive: preferLive || null });
  const holding = poolHoldings.find((item) => item.symbol === symbol) || null;
  const execution = planExecutionContext({ plan: activePlan, holdings: poolHoldings });
  const budget = execution.budget;

  const grid = dcaMultiplier({
    strategy,
    strategyConfig,
    pePct: holding?.pePct,
    grade: holding?.grade,
    assetClass: holding?.assetClass,
    spreadPct: holding?.spreadPct,
  });

  const pool = allocatePoolBudget({
    budget,
    holdings: poolHoldings,
    strategy: normalizeStrategyId(activePlan.strategy),
    strategyConfig,
    strategyOverrides,
    preferTargetGap: execution.phase === "initial",
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
    headline =
      execution.phase === "initial"
        ? "先配置可投资总资金与初期目标仓位"
        : "先在定投计划设置「全池每期预算」";
    reason =
      execution.phase === "initial"
        ? "缺少建仓目标，无法计算建仓额度"
        : "未设置全池预算，无法给出执行金额";
  } else if (pool.deployTotal <= 0) {
    stance = STANCE.HOLD_CASH;
    headline = "本期建议不投，保留现金";
    reason = pool.note || skipped?.reason || "当期均偏弱，建议留现金";
  } else if (amount > 0) {
    stance = STANCE.INVEST;
    headline = `${execution.phase === "initial" ? "建议投入" : "本期建议投入"} ${money(amount)}`;
    reason = mine?.reason || `${grid.band} · ${grid.mult}×`;
  } else {
    stance = STANCE.SKIP;
    headline = "本期不投";
    reason = skipped?.reason || "本期未分到额度";
  }

  const bullets = [`定投倍率 ${grid.mult}×`];
  if (stance === STANCE.INVEST && mine) {
    bullets.push(`约占全池部署 ${mine.sharePct.toFixed(0)}%`);
  } else if (stance === STANCE.SKIP || stance === STANCE.HOLD_CASH) {
    bullets.push(reason);
  } else if (stance === STANCE.NEED_BUDGET) {
    bullets.push(reason);
  }
  const targetWeight =
    holding?.targetWeight != null && Number.isFinite(Number(holding.targetWeight))
      ? Number(holding.targetWeight)
      : null;
  const actualWeight =
    holding?.actualWeight != null && Number.isFinite(Number(holding.actualWeight))
      ? Number(holding.actualWeight)
      : null;
  const position = holding
    ? {
        targetWeight,
        actualWeight,
        drift:
          targetWeight != null && actualWeight != null
            ? Math.round((actualWeight - targetWeight) * 10_000) / 10_000
            : null,
        maxWeight: targetWeight != null ? targetWeight + POSITION_TOLERANCE_PP : null,
        blocked:
          targetWeight != null &&
          actualWeight != null &&
          actualWeight > targetWeight + POSITION_TOLERANCE_PP,
      }
    : null;

  return {
    symbol,
    strategy,
    strategyName,
    strategyOverridden: overridden,
    assetClass: holding?.assetClass || null,
    spreadPct: holding?.spreadPct ?? null,
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
    execution,
    mine,
    skipped,
    bullets,
    position,
    canAdd: stance === STANCE.INVEST,
  };
}

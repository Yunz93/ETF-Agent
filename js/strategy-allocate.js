/**
 * 全池预算分配：建仓金额缺口硬顶、再平衡、周期定投。
 */

import {
  STRATEGY_IDS,
  POSITION_TOLERANCE_PP,
  normalizeStrategyId,
  normalizeStrategyConfig,
  dcaMultiplier,
  sentimentMultiplier,
  sentimentMarketForHolding,
} from "./strategy-multipliers.js";
import { computeCashRelease } from "./strategy-cash.js";

export function rebalanceHint({ targetWeight, actualWeight, name } = {}) {
  if (targetWeight == null || actualWeight == null) return null;
  const drift = actualWeight - targetWeight;
  if (Math.abs(drift) < 5) return null;
  const label = name || "该 ETF";
  if (drift > 0) return `${label} 高出目标 ${drift.toFixed(1)} pp，可少买`;
  return `${label} 低于目标 ${Math.abs(drift).toFixed(1)} pp，可优先补仓`;
}

function rebalanceFactor(targetWeight, actualWeight, enabled) {
  if (!enabled || targetWeight == null || actualWeight == null) return 1;
  const drift = actualWeight - targetWeight;
  if (drift > 15) return 0.35;
  if (drift > 5) return 0.65;
  if (drift < -15) return 1.45;
  if (drift < -5) return 1.25;
  return 1;
}

/**
 * @deprecated 建仓期已改金额缺口硬顶；仅再平衡路径仍可能用软倾斜。
 */
export function buildGapTilt(targetWeight, actualWeight) {
  const target = Number(targetWeight);
  if (!(target > 0)) return 1;
  if (actualWeight == null || !Number.isFinite(Number(actualWeight))) return 1.2;
  const drift = Number(actualWeight) - target;
  if (drift >= 0) {
    return Math.max(0.2, 1 - drift / Math.max(target, 10));
  }
  return Math.min(1.8, 1 + -drift / Math.max(target, 10));
}

/**
 * 按 score 比例分配 deployTotal，且每只硬顶不超过 maxAmount（缺口）。
 * 超额份额迭代再分给仍有空间的品种。
 */
export function allocateWithCaps(eligible, deployTotal) {
  const rows = (eligible || []).map((row) => ({
    ...row,
    maxAmount: Number.isFinite(Number(row.maxAmount ?? row.gapAmt))
      ? Math.max(0, Number(row.maxAmount ?? row.gapAmt))
      : Infinity,
    score: Math.max(0, Number(row.score) || 0),
    amount: 0,
  }));
  let remaining = Math.max(0, Math.round(Number(deployTotal) || 0));
  if (!(remaining > 0) || !rows.length) return rows;

  for (let guard = 0; guard < 16 && remaining > 0; guard += 1) {
    const open = rows.filter((row) => row.score > 0 && row.amount < row.maxAmount - 1e-9);
    if (!open.length) break;
    const scoreSum = open.reduce((sum, row) => sum + row.score, 0) || 1;
    let spent = 0;
    for (let i = 0; i < open.length; i += 1) {
      const row = open[i];
      const room = Math.max(0, row.maxAmount - row.amount);
      let share =
        i === open.length - 1
          ? remaining - spent
          : Math.round((remaining * row.score) / scoreSum);
      share = Math.max(0, Math.min(room, share));
      row.amount += share;
      spent += share;
    }
    if (!(spent > 0)) break;
    remaining = Math.max(0, remaining - spent);
  }
  return rows;
}

function emptyAllocation(totalBudget) {
  return {
    budget: Number.isFinite(totalBudget) && totalBudget > 0 ? totalBudget : 0,
    deployTotal: 0,
    cashKeep: Number.isFinite(totalBudget) && totalBudget > 0 ? Math.round(totalBudget) : 0,
    cashRelease: 0,
    poolBaseMult: null,
    deployFrac: 0,
    allocations: [],
    skipped: [],
    strategy: "valuation",
  };
}

/** 周期定投阶段：按池加权基础倍率决定可从现金池释放的额度。 */
function poolWeightedBaseMult(rows) {
  let weightSum = 0;
  let weighted = 0;
  for (const row of rows) {
    const target = Number(row.targetWeight);
    const base = Number(row.baseMult);
    if (!(target > 0) || !Number.isFinite(base)) continue;
    weightSum += target;
    weighted += target * base;
  }
  if (!(weightSum > 0)) return null;
  return Math.round((weighted / weightSum) * 1000) / 1000;
}

function finalizeEligible({
  totalBudget,
  eligible,
  skipped,
  forceFullDeploy,
  note,
  strategy,
  cashRelease = 0,
  poolBaseMult = null,
}) {
  if (!eligible.length) {
    return {
      ...emptyAllocation(totalBudget),
      budget: Math.round(totalBudget),
      cashKeep: Math.round(totalBudget),
      cashRelease: 0,
      poolBaseMult,
      skipped,
      strategy,
      note: note || "当期均偏弱，建议留现金。",
    };
  }

  let deployFrac;
  if (forceFullDeploy) {
    deployFrac = 1;
  } else {
    const eligTargetSum = eligible.reduce((sum, row) => sum + row.targetWeight, 0) || eligible.length;
    const intensity =
      eligible.reduce((sum, row) => sum + (row.targetWeight / eligTargetSum) * row.mult * row.reb, 0) || 0;
    deployFrac = Math.max(0, Math.min(1, intensity));
  }
  const fromBudget = Math.round(totalBudget * deployFrac);
  const requestedRelease = Math.max(0, Math.round(Number(cashRelease) || 0));
  // 总部署硬顶 3×budget
  const deployLimit = Math.min(fromBudget + requestedRelease, Math.round(totalBudget * 3));
  const capped = allocateWithCaps(eligible, deployLimit);
  const deployTotal = capped.reduce((sum, row) => sum + row.amount, 0);
  const appliedRelease = Math.max(0, deployTotal - fromBudget);
  const allocations = capped.filter((row) => row.amount > 0).map((row) => {
    const amount = row.amount;
    return {
      symbol: row.symbol,
      name: row.name,
      amount,
      band: row.band,
      mult: row.mult,
      baseMult: row.baseMult ?? row.mult,
      sentimentMult: row.sentimentMult ?? 1,
      sentiment: row.sentiment || null,
      targetWeight: row.targetWeight,
      actualWeight: row.actualWeight,
      sharePct: deployTotal > 0 ? (amount / deployTotal) * 100 : 0,
      reason: row.hint,
    };
  });

  const noteParts = [];
  if (deployFrac < 0.999) noteParts.push("未部署部分留现金");
  else if (note) noteParts.push(note);
  if (deployTotal < deployLimit) noteParts.push("仓位上限未用额度留现金");
  if (appliedRelease > 0) noteParts.push(`低估释放现金池 ¥${appliedRelease.toLocaleString("zh-CN")}`);

  return {
    budget: Math.round(totalBudget),
    deployTotal,
    cashKeep: Math.round(totalBudget - Math.min(fromBudget, deployTotal)),
    cashRelease: appliedRelease,
    poolBaseMult,
    deployFrac,
    allocations,
    skipped,
    strategy,
    note: noteParts.join(" · "),
  };
}

/**
 * 全池定投分配。
 * - budget：整池每期总预算（不是单只 ETF）
 * - strategy / strategyConfig：策略类型与自定义配置
 * - strategyOverrides：按品种覆盖策略（{ symbol: strategyId }）
 * - sentimentByMarket：{ A|HK|US: snapshot }，估值/评分/自定义可叠加情绪倍率
 * - analysisRegistry：用于 equity_growth 的市场分区推断
 * - 建仓期（preferTargetGap）：按金额缺口硬顶分配；需 buildTargetAmount（建仓总目标元）
 * - 全池估值暂停（均 mult=0）时建仓也不买，留现金
 * - 周期定投：目标权重 + 容忍区为硬上限；估值暂停（mult=0）仍可把份额让给其他品种
 * - 定额 / 再平衡 / 有可买的建仓：默认打满预算
 * - cashReserve：现金池余额；周期定投阶段可按池加权基础倍率释放，建仓期不启用
 * - quoteMissing：缺行情冻结，不参与缺口放大
 *
 * holdings: [{ symbol, name, targetWeight, actualWeight, marketValue, quoteMissing, pePct, grade, assetClass, spreadPct, biasPct, analyzed }]
 */
export function allocatePoolBudget({
  budget,
  holdings = [],
  strategy = "valuation",
  strategyConfig,
  preferTargetGap = false,
  strategyOverrides,
  sentimentByMarket = null,
  analysisRegistry = null,
  goldMacro = null,
  cashReserve = 0,
  buildTargetAmount = null,
} = {}) {
  const totalBudget = Number(budget);
  const strategyId = normalizeStrategyId(strategy);
  const config = normalizeStrategyConfig(strategyConfig);
  const overrides =
    strategyOverrides && typeof strategyOverrides === "object" ? strategyOverrides : {};
  const registry =
    analysisRegistry && typeof analysisRegistry === "object" ? analysisRegistry : {};
  const reserveBalance = Math.max(0, Number(cashReserve) || 0);
  const empty = { ...emptyAllocation(totalBudget), strategy: strategyId };
  if (!Number.isFinite(totalBudget) || totalBudget <= 0 || !holdings.length) return empty;

  function resolveRowStrategy(item) {
    const raw = overrides[item.symbol];
    if (raw == null || raw === "") return { id: strategyId, overridden: false };
    const id = String(raw || "").trim().toLowerCase();
    if (!STRATEGY_IDS.includes(id)) return { id: strategyId, overridden: false };
    return { id, overridden: true };
  }

  function rowMultiplier(item, fallbackStrategy) {
    const { id, overridden } = resolveRowStrategy(item);
    const grid = dcaMultiplier({
      strategy: overridden ? id : fallbackStrategy,
      strategyConfig: config,
      pePct: item.pePct,
      grade: item.grade,
      assetClass: item.assetClass,
      spreadPct: item.spreadPct,
      biasPct: item.biasPct,
      goldMacro: item.goldMacro || goldMacro,
    });
    if (overridden) {
      return { ...grid, band: `指定 · ${grid.band}`, strategyId: id };
    }
    return { ...grid, strategyId: id };
  }

  function withSentiment(item, grid) {
    const rowStrategyId = grid.strategyId || strategyId;
    const sentCfg = config.sentiment;
    const allowed =
      sentCfg.enabled &&
      sentCfg.mode === "overlay" &&
      sentCfg.apply_to.includes(rowStrategyId);
    if (!allowed || !(grid.mult > 0)) {
      return {
        ...grid,
        baseMult: grid.mult,
        sentimentMult: 1,
        sentiment: null,
      };
    }
    const market = sentimentMarketForHolding(item, sentCfg, registry);
    if (!market) {
      return {
        ...grid,
        baseMult: grid.mult,
        sentimentMult: 1,
        sentiment: null,
      };
    }
    const snapshot =
      sentimentByMarket && typeof sentimentByMarket === "object"
        ? sentimentByMarket[market]
        : null;
    const sent = sentimentMultiplier(snapshot, sentCfg);
    // 组合倍率硬顶 1.8×（三位小数四舍五入）
    const mult = Math.round(Math.min(1.8, grid.mult * sent.mult) * 1000) / 1000;
    const hint =
      sent.mult !== 1
        ? `${grid.hint || "按策略参与"}；情绪 ${sent.band} ×${sent.mult}`
        : grid.hint;
    const band =
      sent.mult !== 1 && grid.band ? `${grid.band} · 情绪${sent.band}` : grid.band;
    return {
      ...grid,
      mult,
      band,
      hint,
      baseMult: grid.mult,
      sentimentMult: sent.mult,
      sentiment: { market, ...sent },
    };
  }

  const n = holdings.length;
  const hasTargets = holdings.some((item) => Number(item.targetWeight) > 0);
  const equal = 100 / n;
  const useReb =
    preferTargetGap || strategyId === "fixed" || strategyId === "rebalance"
      ? false
      : strategyId === "custom"
        ? config.use_rebalance
        : true;
  const portfolioValue = holdings.reduce((sum, item) => {
    const value = Number(item.marketValue);
    return Number.isFinite(value) && value > 0 ? sum + value : sum;
  }, 0);

  function positionBuyRoom(item, targetWeight, actualWeight) {
    const maxWeight = Math.min(100, Math.max(0, targetWeight + POSITION_TOLERANCE_PP));
    if (actualWeight != null && actualWeight >= maxWeight) return 0;
    const currentValue = Number(item.marketValue);
    if (!(portfolioValue > 0) || !Number.isFinite(currentValue) || maxWeight >= 100) {
      return Infinity;
    }
    const cap = maxWeight / 100;
    return Math.max(0, Math.floor((cap * portfolioValue - currentValue) / (1 - cap)));
  }

  // —— 建仓期：金额缺口硬顶；倍率只决定缺口间优先级 ——
  if (preferTargetGap && strategyId !== "rebalance") {
    const targetTotal = Number(buildTargetAmount);
    const weightSum = holdings.reduce((sum, item) => {
      const tw = hasTargets
        ? Number(item.targetWeight) > 0
          ? Number(item.targetWeight)
          : 0
        : equal;
      return sum + Math.max(0, tw);
    }, 0);

    const prepared = holdings.map((item) => {
      const target = hasTargets
        ? Number(item.targetWeight) > 0
          ? Number(item.targetWeight)
          : 0
        : equal;
      const actual =
        item.actualWeight != null && Number.isFinite(Number(item.actualWeight))
          ? Number(item.actualWeight)
          : null;
      const quoteMissing = item.quoteMissing === true;
      const mvRaw = item.marketValue;
      const marketValue =
        mvRaw == null || !Number.isFinite(Number(mvRaw)) ? null : Math.max(0, Number(mvRaw));
      const grid = withSentiment(item, rowMultiplier(item, strategyId));
      const targetAmt =
        targetTotal > 0 && weightSum > 0 ? (targetTotal * Math.max(0, target)) / weightSum : 0;
      let gapAmt = 0;
      let frozen = false;
      if (quoteMissing || (marketValue == null && Number(item.shares) > 0)) {
        frozen = true;
        gapAmt = 0;
      } else if (targetAmt > 0) {
        gapAmt = Math.max(0, targetAmt - (marketValue ?? 0));
      }
      return {
        symbol: item.symbol,
        name: item.name || item.symbol,
        targetWeight: target,
        actualWeight: actual,
        marketValue,
        targetAmt,
        gapAmt,
        quoteMissing: frozen,
        analyzed: item.analyzed !== false,
        mult: grid.mult,
        baseMult: grid.baseMult ?? grid.mult,
        sentimentMult: grid.sentimentMult ?? 1,
        sentiment: grid.sentiment,
        band: grid.band,
        hint: grid.hint,
        reb: 1,
        indexCode: String(
          item.indexCode || registry[item.symbol]?.index_code || "",
        ).trim(),
      };
    });

    // 同指数：有费率数据则只留最优；否则组缺口硬顶在分配时施加
    const indexGroups = new Map();
    for (const row of prepared) {
      if (!row.indexCode) continue;
      if (!indexGroups.has(row.indexCode)) indexGroups.set(row.indexCode, []);
      indexGroups.get(row.indexCode).push(row);
    }
    for (const group of indexGroups.values()) {
      if (group.length < 2) continue;
      const withFee = group
        .map((row) => {
          const fee = Number(registry[row.symbol]?.annual_fee_pct);
          // products 可能在 registry 旁路：调用方也可挂在 item 上；此处仅用 analysisRegistry 可选字段
          const productFee = Number(
            (analysisRegistry && analysisRegistry.__products?.[row.symbol]?.annual_fee_pct) ??
              fee,
          );
          return Number.isFinite(productFee) ? { row, fee: productFee } : null;
        })
        .filter(Boolean);
      // fee 数据走 products，由调用方通过 applyIndexExposureGroups 预处理更干净；此处做组缺口
      const groupGap = Math.max(
        0,
        group.reduce((sum, row) => sum + Math.max(0, row.targetAmt || 0), 0) -
          group.reduce((sum, row) => sum + Math.max(0, row.marketValue || 0), 0),
      );
      for (const row of group) row.groupGap = groupGap;
      for (const row of group) row.groupSymbols = group.map((item) => item.symbol);
    }

    const anyAttractive = prepared.some(
      (row) => row.targetWeight > 0 && row.mult > 0 && !row.quoteMissing,
    );
    const rows = prepared.map((row) => {
      const effMult = row.mult;
      let band = row.band || "建仓";
      let hint = row.hint || "按金额缺口参与建仓";
      let score = 0;
      if (row.quoteMissing) {
        band = "等待行情恢复";
        hint = "缺少有效行情，建仓缺口暂不放大";
        score = 0;
      } else if (!(row.targetWeight > 0)) {
        band = "无目标";
        hint = "未设置目标仓位，本期不参与";
      } else if (effMult <= 0) {
        band = row.band || "当期不建议新增";
        hint = anyAttractive
          ? row.hint || "估值偏贵，建仓额度让给其他品种"
          : row.hint || "全池偏贵，建仓期暂不买入、留现金";
      } else if (!(row.gapAmt > 0)) {
        band = `${band} · 已达目标`;
        hint = "市值已达目标金额，本期不买";
        score = 0;
      } else {
        score = row.gapAmt * effMult;
        band = `${band} · 建仓补缺`;
        hint =
          row.sentimentMult !== 1 && row.hint
            ? row.hint
            : `金额缺口 ${Math.round(row.gapAmt)}，优先补仓`;
      }
      return {
        ...row,
        mult: effMult,
        score,
        maxAmount: row.gapAmt,
        band,
        hint,
        positionBlocked: false,
      };
    });

    // 组缺口：同指数合计买入不超过组金额缺口
    const eligibleBase = rows.filter((row) => row.score > 0 && row.maxAmount > 0);
    const gapSum = eligibleBase.reduce((sum, row) => sum + row.maxAmount, 0);
    let deployTotal = Math.min(Math.round(totalBudget), Math.round(gapSum));
    let capped = allocateWithCaps(eligibleBase, deployTotal);

    // 按组缩回
    const groupKeys = new Set(
      capped.map((row) => row.indexCode).filter(Boolean),
    );
    for (const code of groupKeys) {
      const members = capped.filter((row) => row.indexCode === code);
      if (members.length < 2) continue;
      const groupGap = Math.max(0, Number(members[0].groupGap) || 0);
      const groupBuy = members.reduce((sum, row) => sum + row.amount, 0);
      if (groupBuy > groupGap + 1e-9 && groupBuy > 0) {
        const scale = groupGap / groupBuy;
        for (const row of members) {
          row.amount = Math.round(row.amount * scale);
          row.maxAmount = Math.min(row.maxAmount, row.amount + Math.max(0, groupGap));
        }
      }
    }
    deployTotal = capped.reduce((sum, row) => sum + row.amount, 0);

    const allocations = capped
      .filter((row) => row.amount > 0)
      .map((row) => ({
        symbol: row.symbol,
        name: row.name,
        amount: row.amount,
        band: row.band,
        mult: row.mult,
        baseMult: row.baseMult ?? row.mult,
        sentimentMult: row.sentimentMult ?? 1,
        sentiment: row.sentiment || null,
        targetWeight: row.targetWeight,
        actualWeight: row.actualWeight,
        sharePct: deployTotal > 0 ? (row.amount / deployTotal) * 100 : 0,
        reason: row.hint,
      }));
    const skipped = rows
      .filter((row) => !allocations.some((item) => item.symbol === row.symbol))
      .map((row) => ({
        symbol: row.symbol,
        name: row.name,
        band: row.band,
        reason: row.hint,
      }));

    return {
      budget: Math.round(totalBudget),
      deployTotal,
      cashKeep: Math.round(totalBudget - deployTotal),
      cashRelease: 0,
      poolBaseMult: poolWeightedBaseMult(rows),
      deployFrac: totalBudget > 0 ? deployTotal / totalBudget : 0,
      allocations,
      skipped,
      strategy: strategyId,
      note: !anyAttractive
        ? "全池偏贵，建仓期建议留现金"
        : deployTotal > 0
          ? "建仓期按金额缺口硬顶分配"
          : "建仓缺口已满或等待行情",
    };
  }

  // —— 再平衡：按缺口补仓，目标容忍区为硬上限 ——
  if (strategyId === "rebalance") {
    const rows = holdings.map((item) => {
      const target = hasTargets
        ? Number(item.targetWeight) > 0
          ? Number(item.targetWeight)
          : 0
        : equal;
      const actual =
        item.actualWeight != null && Number.isFinite(Number(item.actualWeight))
          ? Number(item.actualWeight)
          : null;
      const deficit = actual == null ? target : Math.max(0, target - actual);
      const tilt = buildGapTilt(target, actual);
      // 明显低配用缺口；已贴近目标保留小额再平衡，达到容忍上限则停买
      const drift = actual != null ? actual - target : null;
      const positionBlocked = drift != null && drift >= POSITION_TOLERANCE_PP;
      const score = positionBlocked
        ? 0
        : target > 0
          ? (deficit > 0 ? deficit : target * 0.05) * tilt
          : 0;
      return {
        symbol: item.symbol,
        name: item.name || item.symbol,
        targetWeight: target,
        actualWeight: actual,
        analyzed: item.analyzed !== false,
        mult: 1,
        baseMult: 1,
        sentimentMult: 1,
        sentiment: null,
        band: deficit > 0 ? "待补仓" : positionBlocked ? "仓位已达上限" : "已达标",
        hint:
          deficit > 0
            ? `低于目标 ${deficit.toFixed(1)} pp`
            : positionBlocked
              ? `已达到目标容忍上限（偏离 ${drift.toFixed(1)} pp），本期停止新增`
              : actual == null
                ? "尚无持仓市值，按目标仓位参与"
                : "已达或高于目标",
        reb: 1,
        score,
        deficit,
        positionBlocked,
        maxAmount: positionBuyRoom(item, target, actual),
      };
    });

    let eligible = rows.filter((row) => row.score > 0 && row.deficit > 0);
    if (!eligible.length) {
      eligible = rows
        .filter((row) => row.targetWeight > 0 && !row.positionBlocked)
        .map((row) => ({
          ...row,
          score: row.targetWeight * row.mult,
          band: "按目标",
          hint: "无明显低配，按目标仓位分配",
        }));
    }
    const skipped = rows
      .filter((row) => !eligible.some((item) => item.symbol === row.symbol))
      .map((row) => ({
        symbol: row.symbol,
        name: row.name,
        band: row.band,
        reason: row.hint,
        positionBlocked: row.positionBlocked,
      }));
    const rebRows = rows;
    const poolBaseMult = poolWeightedBaseMult(rebRows);
    const cashRelease = computeCashRelease({
      budget: totalBudget,
      cashReserve: reserveBalance,
      poolBaseMult,
      preferTargetGap: false,
    });
    return finalizeEligible({
      totalBudget,
      eligible,
      skipped,
      forceFullDeploy: true,
      strategy: strategyId,
      cashRelease,
      poolBaseMult,
    });
  }

  // —— 周期定投：估值调节部署比例；仓位硬顶；缺行情冻结 ——
  const rows = holdings.map((item) => {
    const target = hasTargets
      ? Number(item.targetWeight) > 0
        ? Number(item.targetWeight)
        : 0
      : equal;
    const actual =
      item.actualWeight != null && Number.isFinite(Number(item.actualWeight))
        ? Number(item.actualWeight)
        : null;
    const quoteMissing =
      item.quoteMissing === true ||
      (Number(item.shares) > 0 &&
        (item.marketValue == null || !Number.isFinite(Number(item.marketValue))));
    if (quoteMissing) {
      return {
        symbol: item.symbol,
        name: item.name || item.symbol,
        targetWeight: target,
        actualWeight: actual,
        analyzed: item.analyzed !== false,
        mult: 0,
        baseMult: 0,
        sentimentMult: 1,
        sentiment: null,
        band: "等待行情恢复",
        hint: "缺少有效行情，本期暂不参与分配",
        positionBlocked: false,
        reb: 1,
        score: 0,
      };
    }
    const grid = withSentiment(item, rowMultiplier(item, strategyId));
    const reb = rebalanceFactor(target, actual, useReb);
    const drift = actual != null && target > 0 ? actual - target : null;
    const positionBlocked = drift != null && drift >= POSITION_TOLERANCE_PP;
    const score = !positionBlocked && target > 0 && grid.mult > 0
      ? (target / 100) * grid.mult * reb
      : 0;
    return {
      symbol: item.symbol,
      name: item.name || item.symbol,
      targetWeight: target,
      actualWeight: actual,
      analyzed: item.analyzed !== false,
      ...grid,
      band: positionBlocked ? "仓位已达上限" : grid.band,
      hint:
        positionBlocked
          ? `已达到目标容忍上限（偏离 ${drift.toFixed(1)} pp），本期停止新增`
          : grid.hint,
      positionBlocked,
      maxAmount: positionBuyRoom(item, target, actual),
      reb,
      score,
    };
  });

  const eligible = rows.filter((row) => row.score > 0 && row.mult > 0 && !row.positionBlocked);
  const skipped = rows
    .filter((row) => row.mult <= 0 || row.score <= 0)
    .map((row) => ({
      symbol: row.symbol,
      name: row.name,
      band: row.band,
      reason: row.positionBlocked
        ? row.hint
        : row.mult <= 0
          ? "当期不建议新增"
          : "吸引力不足",
      positionBlocked: row.positionBlocked,
    }));

  const poolBaseMult = poolWeightedBaseMult(rows);
  const cashRelease = computeCashRelease({
    budget: totalBudget,
    cashReserve: reserveBalance,
    poolBaseMult,
    preferTargetGap: false,
  });
  return finalizeEligible({
    totalBudget,
    eligible,
    skipped,
    forceFullDeploy: strategyId === "fixed",
    strategy: strategyId,
    cashRelease,
    poolBaseMult,
  });
}

export function allocationForSymbol(result, symbol) {
  if (!result) return null;
  return (result.allocations || []).find((item) => item.symbol === symbol) || null;
}

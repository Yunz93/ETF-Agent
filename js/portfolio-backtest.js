/**
 * 组合级滚动回测骨架（纯函数，合成/夹具数据可测）。
 *
 * 简化假设：每期按目标权重×策略倍率分配预算；估值策略在 pePct 高时降倍率留现金。
 */

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

/** 简化估值倍率：pePct≥0.8 → 0；≥0.6 → 0.5；否则 1。 */
export function simpleValuationMult(pePct) {
  const p = Number(pePct);
  if (!Number.isFinite(p)) return 1;
  const pct = p <= 1 ? p : p / 100;
  if (pct >= 0.8) return 0;
  if (pct >= 0.6) return 0.5;
  return 1;
}

function annualizeReturn(totalReturn, days) {
  if (!(days > 0)) return 0;
  const years = days / 252;
  if (!(years > 0)) return 0;
  return (1 + totalReturn) ** (1 / years) - 1;
}

function maxDrawdown(equityCurve) {
  let peak = -Infinity;
  let maxDd = 0;
  for (const value of equityCurve) {
    if (value > peak) peak = value;
    if (peak > 0) {
      const dd = (peak - value) / peak;
      if (dd > maxDd) maxDd = dd;
    }
  }
  return maxDd;
}

function volatility(returns) {
  if (!returns.length) return 0;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

/**
 * @param {{
 *   series: Record<string, number[]>, // symbol -> close[]
 *   peSeries?: Record<string, number[]>,
 *   weights: Record<string, number>, // %
 *   mode?: "fixed"|"valuation",
 *   budgetPerPeriod?: number,
 *   feeRate?: number,
 *   rebalanceEvery?: number,
 * }} input
 */
export function runPortfolioBacktest({
  series = {},
  peSeries = {},
  weights = {},
  mode = "fixed",
  budgetPerPeriod = 1000,
  feeRate = 0.0003,
  rebalanceEvery = 20,
} = {}) {
  const symbols = Object.keys(weights).filter((symbol) => Array.isArray(series[symbol]));
  if (!symbols.length) {
    return {
      annualReturn: 0,
      maxDrawdown: 0,
      volatility: 0,
      endingCashRatio: 1,
      turnoverApprox: 0,
      mode,
    };
  }
  const length = Math.min(...symbols.map((symbol) => series[symbol].length));
  if (length < 2) {
    return {
      annualReturn: 0,
      maxDrawdown: 0,
      volatility: 0,
      endingCashRatio: 1,
      turnoverApprox: 0,
      mode,
    };
  }

  const weightSum = symbols.reduce((sum, symbol) => sum + Math.max(0, Number(weights[symbol]) || 0), 0) || 1;
  const target = Object.fromEntries(
    symbols.map((symbol) => [symbol, Math.max(0, Number(weights[symbol]) || 0) / weightSum]),
  );

  let cash = 0;
  const shares = Object.fromEntries(symbols.map((symbol) => [symbol, 0]));
  let turnover = 0;
  const performanceCurve = [1];
  const periodReturns = [];
  let wealthIndex = 1;
  let previousPostFlowEquity = 0;
  let lastPrices = null;

  for (let i = 0; i < length; i += 1) {
    const prices = Object.fromEntries(symbols.map((symbol) => [symbol, Number(series[symbol][i]) || 0]));
    lastPrices = prices;
    let preFlowEquity = cash;
    for (const symbol of symbols) preFlowEquity += shares[symbol] * prices[symbol];
    let growthFactor = previousPostFlowEquity > 0 ? preFlowEquity / previousPostFlowEquity : 1;

    if (i % rebalanceEvery === 0) {
      cash += Math.max(0, Number(budgetPerPeriod) || 0);
      let preTradeEquity = cash;
      for (const symbol of symbols) preTradeEquity += shares[symbol] * prices[symbol];

      if (preTradeEquity > 0) {
        for (const symbol of symbols) {
          let mult = 1;
          if (mode === "valuation") {
            const pe = peSeries[symbol]?.[i];
            mult = simpleValuationMult(pe);
          }
          const desiredValue = preTradeEquity * target[symbol] * clamp01(mult);
          const currentValue = shares[symbol] * prices[symbol];
          const deltaValue = desiredValue - currentValue;
          if (!(prices[symbol] > 0) || Math.abs(deltaValue) < 1e-9) continue;
          const tradeValue = Math.abs(deltaValue);
          const fee = tradeValue * Math.max(0, Number(feeRate) || 0);
          if (deltaValue > 0) {
            const affordable = Math.min(deltaValue, Math.max(0, cash - fee));
            if (affordable > 0) {
              const buyShares = affordable / prices[symbol];
              shares[symbol] += buyShares;
              cash -= affordable + fee;
              turnover += affordable;
            }
          } else {
            const sellShares = Math.min(shares[symbol], tradeValue / prices[symbol]);
            const proceeds = sellShares * prices[symbol];
            shares[symbol] -= sellShares;
            cash += Math.max(0, proceeds - fee);
            turnover += proceeds;
          }
        }
      }

      let postTradeEquity = cash;
      for (const symbol of symbols) postTradeEquity += shares[symbol] * prices[symbol];
      if (preTradeEquity > 0) {
        growthFactor *= postTradeEquity / preTradeEquity;
      }
    }

    let postFlowEquity = cash;
    for (const symbol of symbols) postFlowEquity += shares[symbol] * prices[symbol];
    previousPostFlowEquity = postFlowEquity;
    const periodReturn = Number.isFinite(growthFactor) ? growthFactor - 1 : 0;
    periodReturns.push(periodReturn);
    wealthIndex *= 1 + periodReturn;
    performanceCurve.push(wealthIndex);
  }

  let endingEquity = cash;
  for (const symbol of symbols) endingEquity += shares[symbol] * (lastPrices?.[symbol] || 0);
  const endingCashRatio = endingEquity > 0 ? Math.max(0, cash) / endingEquity : 1;
  const totalReturn = wealthIndex - 1;

  return {
    annualReturn: annualizeReturn(totalReturn, length - 1),
    maxDrawdown: maxDrawdown(performanceCurve),
    volatility: volatility(periodReturns),
    endingCashRatio,
    turnoverApprox: endingEquity > 0 ? turnover / endingEquity : 0,
    mode,
    endingEquity,
    periods: length,
  };
}

/** fixed vs valuation 对比摘要 */
export function compareFixedVsValuation(input) {
  const fixed = runPortfolioBacktest({ ...input, mode: "fixed" });
  const valuation = runPortfolioBacktest({ ...input, mode: "valuation" });
  return { fixed, valuation };
}

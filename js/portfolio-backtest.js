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

function annualizeReturn(totalReturn, years) {
  if (!(years > 0)) return null;
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

function volatility(returns, periodsPerYear) {
  if (!returns.length) return 0;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(periodsPerYear);
}

function xirr(dateDays, contributions, endingValue) {
  const end = dateDays.at(-1);
  const years = dateDays.map((day) => (end - day) / 365);
  if (!contributions.some((amount, i) => amount > 0 && years[i] > 0)) return null;
  const balance = (logRate) => {
    const exponents = years.map((age) => logRate * age);
    const scale = Math.max(0, ...exponents);
    return contributions.reduce((sum, amount, i) => sum + amount * Math.exp(exponents[i] - scale), 0)
      - endingValue * Math.exp(-scale);
  };
  let low = -20;
  let high = 20;
  if (balance(low) >= 0 || balance(high) <= 0) return null;
  for (let i = 0; i < 160; i += 1) {
    const mid = (low + high) / 2;
    if (balance(mid) > 0) high = mid;
    else low = mid;
  }
  return Math.expm1((low + high) / 2);
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
 *   dates?: string[], // aligned ISO dates; enables ACT/365 annualization and XIRR
 *   periodsPerYear?: number, // 252 for daily observations; 12 for monthly
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
  dates = null,
  periodsPerYear = 252,
} = {}) {
  const unavailable = (reason) => ({
    status: "insufficient_history", annualReturn: null, maxDrawdown: null,
    volatility: null, endingCashRatio: 1, turnoverApprox: null, mode,
    limitations: [reason],
  });
  const symbols = Object.keys(weights).filter((symbol) => Number(weights[symbol]) > 0);
  if (!symbols.length || symbols.some((symbol) => !Number.isFinite(Number(weights[symbol]))
      || !Array.isArray(series[symbol]))) {
    return unavailable("缺少目标品种的历史行情");
  }
  const length = series[symbols[0]].length;
  if (length < 2 || symbols.some((symbol) => series[symbol].length !== length
      || series[symbol].some((price) => !Number.isFinite(price) || price <= 0))) {
    return unavailable("历史价格必须有效且逐期对齐");
  }
  let dateDays = null;
  if (dates !== null) {
    if (!Array.isArray(dates) || dates.length !== length) return unavailable("日期与行情未对齐");
    dateDays = dates.map((day) => Date.parse(`${day}T00:00:00Z`) / 86400000);
    if (dateDays.some((day, i) => !Number.isFinite(day)
        || new Date(day * 86400000).toISOString().slice(0, 10) !== dates[i]
        || (i > 0 && day <= dateDays[i - 1]))) return unavailable("日期必须有效且严格递增");
  }
  if (!Number.isFinite(periodsPerYear) || periodsPerYear <= 0
      || !Number.isInteger(rebalanceEvery) || rebalanceEvery < 1) {
    return unavailable("采样频率与交易间隔必须为正值");
  }
  if (!Number.isFinite(budgetPerPeriod) || budgetPerPeriod <= 0
      || !Number.isFinite(feeRate) || feeRate < 0 || feeRate >= 1) {
    return unavailable("投入金额必须为正，费率必须在 0 与 1 之间");
  }
  if (mode === "valuation" && symbols.some((symbol) => series[symbol].some((_, i) =>
    i % rebalanceEvery === 0 && (!Number.isFinite(peSeries[symbol]?.[i])
      || peSeries[symbol][i] < 0 || peSeries[symbol][i] > 100)))) {
    return unavailable("估值策略缺少交易时已知的 PE 分位；基础策略仍可独立验证");
  }

  const weightSum = symbols.reduce((sum, symbol) => sum + Math.max(0, Number(weights[symbol]) || 0), 0) || 1;
  const target = Object.fromEntries(
    symbols.map((symbol) => [symbol, Math.max(0, Number(weights[symbol]) || 0) / weightSum]),
  );

  let cash = 0;
  const shares = Object.fromEntries(symbols.map((symbol) => [symbol, 0]));
  let turnover = 0;
  let fees = 0;
  const contributions = [];
  const equityCurve = [];
  const cashRatios = [];
  const performanceCurve = [1];
  let wealthIndex = 1;
  let previousPostFlowEquity = 0;
  let lastPrices = null;

  for (let i = 0; i < length; i += 1) {
    const prices = Object.fromEntries(symbols.map((symbol) => [symbol, Number(series[symbol][i]) || 0]));
    lastPrices = prices;
    let preFlowEquity = cash;
    for (const symbol of symbols) preFlowEquity += shares[symbol] * prices[symbol];
    let growthFactor = previousPostFlowEquity > 0 ? preFlowEquity / previousPostFlowEquity : 1;

    const contribution = i % rebalanceEvery === 0 ? Math.max(0, Number(budgetPerPeriod) || 0) : 0;
    contributions.push(contribution);
    if (i % rebalanceEvery === 0) {
      cash += contribution;
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
          const rate = Math.max(0, Number(feeRate) || 0);
          if (deltaValue > 0) {
            const affordable = Math.min(deltaValue, Math.max(0, cash / (1 + rate)));
            if (affordable > 0) {
              const fee = affordable * rate;
              const buyShares = affordable / prices[symbol];
              shares[symbol] += buyShares;
              cash -= affordable + fee;
              turnover += affordable;
              fees += fee;
            }
          } else {
            const sellShares = Math.min(shares[symbol], tradeValue / prices[symbol]);
            const proceeds = sellShares * prices[symbol];
            const fee = proceeds * rate;
            shares[symbol] -= sellShares;
            cash += Math.max(0, proceeds - fee);
            turnover += proceeds;
            fees += fee;
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
    equityCurve.push(postFlowEquity);
    cashRatios.push(postFlowEquity > 0 ? cash / postFlowEquity : 1);
    const periodReturn = Number.isFinite(growthFactor) ? growthFactor - 1 : 0;
    wealthIndex *= 1 + periodReturn;
    performanceCurve.push(wealthIndex);
  }

  let endingEquity = cash;
  for (const symbol of symbols) endingEquity += shares[symbol] * (lastPrices?.[symbol] || 0);
  const endingCashRatio = endingEquity > 0 ? Math.max(0, cash) / endingEquity : 1;
  const totalReturn = wealthIndex - 1;
  const intervalCurve = [1, ...performanceCurve.slice(2)];
  const periodReturns = intervalCurve.slice(1).map((value, i) => value / intervalCurve[i] - 1);
  const years = dateDays ? (dateDays.at(-1) - dateDays[0]) / 365 : (length - 1) / periodsPerYear;
  const contributedCapital = contributions.reduce((sum, amount) => sum + amount, 0);
  const averageEquity = equityCurve.reduce((sum, value) => sum + value, 0) / length;

  return {
    status: "ready",
    annualReturn: annualizeReturn(totalReturn, years),
    totalReturn,
    moneyWeightedReturn: dateDays ? xirr(dateDays, contributions, endingEquity) : null,
    contributedCapital,
    netProfit: endingEquity - contributedCapital,
    fees,
    maxDrawdown: maxDrawdown(performanceCurve),
    volatility: volatility(periodReturns, periodsPerYear),
    endingCashRatio,
    averageCashRatio: cashRatios.reduce((sum, value) => sum + value, 0) / length,
    turnoverApprox: averageEquity > 0 ? turnover / averageEquity : 0,
    mode,
    endingEquity,
    periods: length,
    methodology: {
      return_basis: "time_weighted_net_of_trading_fees",
      annualization_basis: dateDays ? "ACT/365" : `${periodsPerYear}_observations_per_year`,
      money_weighted_basis: dateDays ? "XIRR_ACT/365" : null,
      volatility_periods_per_year: periodsPerYear,
      drawdown_basis: "unitized_nav",
      price_basis: "supplied_close",
    },
    limitations: [
      "回撤与波动率基于传入采样频率，可能遗漏采样间的下跌",
      "简化研究模型，交易规则与后端不同；仅统一收益计量口径",
      "不自动补计分红、汇率、税费或现金利息；无日期时不计算 XIRR",
    ],
  };
}

/** fixed vs valuation 对比摘要 */
export function compareFixedVsValuation(input) {
  const fixed = runPortfolioBacktest({ ...input, mode: "fixed" });
  const valuation = runPortfolioBacktest({ ...input, mode: "valuation" });
  return { fixed, valuation };
}

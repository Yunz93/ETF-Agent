const DAY_MS = 86_400_000;

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date) {
  const value = startOfDay(date);
  const weekday = value.getDay() || 7;
  value.setDate(value.getDate() - weekday + 1);
  return value;
}

export function planPeriod(plan = {}, now = new Date()) {
  const cadence = plan.cadence || "monthly";
  const day = Math.max(1, Number(plan.day) || 1);
  const today = startOfDay(now);
  let start;
  let end;
  let scheduled;

  if (cadence === "monthly") {
    start = new Date(today.getFullYear(), today.getMonth(), 1);
    end = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    scheduled = new Date(today.getFullYear(), today.getMonth(), Math.min(28, day));
  } else {
    const weekStart = startOfWeek(today);
    if (cadence === "biweekly") {
      const anchor = new Date(1970, 0, 5);
      const weeks = Math.floor((weekStart - anchor) / (7 * DAY_MS));
      start = new Date(weekStart);
      if (Math.abs(weeks % 2) === 1) start.setDate(start.getDate() - 7);
      end = new Date(start);
      end.setDate(end.getDate() + 14);
    } else {
      start = weekStart;
      end = new Date(start);
      end.setDate(end.getDate() + 7);
    }
    scheduled = new Date(start);
    scheduled.setDate(scheduled.getDate() + Math.min(7, day) - 1);
  }

  return {
    start: localDateKey(start),
    end: localDateKey(end),
    scheduled: localDateKey(scheduled),
    daysToScheduled: Math.round((scheduled - today) / DAY_MS),
  };
}

export function cycleExecution({ plan, buys = [], symbol, recommendedAmount = 0, now = new Date() } = {}) {
  const period = planPeriod(plan, now);
  const matching = buys.filter(
    (buy) => buy.symbol === symbol && buy.date >= period.start && buy.date < period.end,
  );
  const executedAmount = matching.reduce((sum, buy) => sum + Number(buy.price) * Number(buy.shares), 0);
  const remainingAmount = Math.max(0, Number(recommendedAmount) - executedAmount);
  const lastBuy = buys.find((buy) => buy.symbol === symbol) || null;
  let status = "waiting";
  if (!(recommendedAmount > 0)) status = "not_required";
  else if (executedAmount >= recommendedAmount * 0.98) status = "completed";
  else if (executedAmount > 0) status = "partial";
  else if (period.daysToScheduled < 0) status = "overdue";
  else if (period.daysToScheduled === 0) status = "due";

  return {
    ...period,
    status,
    executedAmount,
    remainingAmount,
    matchingCount: matching.length,
    lastBuy,
  };
}

export function orderPreview(amount, price, lotSize = 100) {
  const budget = Number(amount);
  const quote = Number(price);
  if (!(budget > 0) || !(quote > 0)) {
    return { shares: 0, estimatedAmount: 0, cashRemainder: Math.max(0, budget || 0), lotSize };
  }
  const shares = Math.floor(budget / quote / lotSize) * lotSize;
  const estimatedAmount = shares * quote;
  return {
    shares,
    estimatedAmount,
    cashRemainder: Math.max(0, budget - estimatedAmount),
    lotSize,
  };
}

export function projectedPosition({
  currentValue = 0,
  portfolioValue = 0,
  buyAmount = 0,
  targetWeight = null,
  tolerance = 5,
} = {}) {
  const nextPortfolioValue = Math.max(0, Number(portfolioValue)) + Math.max(0, Number(buyAmount));
  const nextValue = Math.max(0, Number(currentValue)) + Math.max(0, Number(buyAmount));
  const currentWeight = portfolioValue > 0 ? (Number(currentValue) / Number(portfolioValue)) * 100 : null;
  const projectedWeight = nextPortfolioValue > 0 ? (nextValue / nextPortfolioValue) * 100 : null;
  const maxWeight = targetWeight == null ? null : Number(targetWeight) + tolerance;
  return {
    currentWeight,
    projectedWeight,
    projectedDrift: projectedWeight != null && targetWeight != null ? projectedWeight - Number(targetWeight) : null,
    maxWeight,
    blocked: currentWeight != null && maxWeight != null && currentWeight > maxWeight,
    wouldExceed: projectedWeight != null && maxWeight != null && projectedWeight > maxWeight,
  };
}

function dailyReturns(points = []) {
  const returns = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = Number(points[index - 1]?.close);
    const current = Number(points[index]?.close);
    if (previous > 0 && current > 0) returns.push({ date: points[index].date, value: current / previous - 1 });
  }
  return returns;
}

export function riskMetrics(points = []) {
  const clean = points.filter((point) => Number(point?.close) > 0);
  if (clean.length < 2) return null;
  const returns = dailyReturns(clean);
  const mean = returns.reduce((sum, item) => sum + item.value, 0) / Math.max(1, returns.length);
  const variance = returns.reduce((sum, item) => sum + (item.value - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  let peak = Number(clean[0].close);
  let maxDrawdown = 0;
  let underwater = 0;
  let longestUnderwater = 0;
  for (const point of clean) {
    const close = Number(point.close);
    if (close >= peak) {
      peak = close;
      underwater = 0;
    } else {
      underwater += 1;
      longestUnderwater = Math.max(longestUnderwater, underwater);
      maxDrawdown = Math.min(maxDrawdown, close / peak - 1);
    }
  }
  const years = Math.max(1 / 252, returns.length / 252);
  const annualizedReturn = (Number(clean.at(-1).close) / Number(clean[0].close)) ** (1 / years) - 1;
  return {
    annualizedVolatilityPct: Math.sqrt(variance * 252) * 100,
    maxDrawdownPct: maxDrawdown * 100,
    longestUnderwaterDays: longestUnderwater,
    annualizedReturnPct: annualizedReturn * 100,
    samples: clean.length,
  };
}

export function returnCorrelation(leftPoints = [], rightPoints = []) {
  const left = new Map(dailyReturns(leftPoints).map((item) => [item.date, item.value]));
  const pairs = dailyReturns(rightPoints)
    .filter((item) => left.has(item.date))
    .map((item) => [left.get(item.date), item.value]);
  if (pairs.length < 20) return null;
  const leftMean = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length;
  const rightMean = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (const [leftValue, rightValue] of pairs) {
    covariance += (leftValue - leftMean) * (rightValue - rightMean);
    leftVariance += (leftValue - leftMean) ** 2;
    rightVariance += (rightValue - rightMean) ** 2;
  }
  const denominator = Math.sqrt(leftVariance * rightVariance);
  return denominator > 0 ? { value: covariance / denominator, samples: pairs.length } : null;
}


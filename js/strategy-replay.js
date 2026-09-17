/** Read-only deterministic replay. No network, state singleton, or persisted workspace writes. */
import { applyIndexExposureGroups } from "./index-exposure.js";
import { buildTradePlan } from "./trade-plan.js";
import { buildSignalSnapshot } from "./signal-snapshot.js";
import { planExecutionContext, planPeriod, stampInitialBuildStarted, orderPreview } from "./decision-support.js";
import { sentimentMarketForHolding } from "./strategy.js";
import { normalizePlan } from "./workspace_model.js";

export const REPLAY_SCHEMA = "stockagent-strategy-replay-v1";
export const REPLAY_LIMITATIONS = [
  "固定倍率基准与配置策略使用相同卖出纪律、执行约束、入金与历史数据，仅关闭买入倍率及情绪叠加",
  "固定参数按时间前 70% / 后 30% 留出比较，不优化参数；历史选参仍可能污染留出段，不宣称真正前瞻样本外验证",
  "复用当前交易规划与信号快照，每期计划日或其后第一个共同交易日评估一次；不模拟人工放行、盘中重试、AI 或人工调整",
  "拆并份按所列份额因子在开盘前调整，分红按调整后的持有份额入账；入金也视为当日开始，收益按日剔除外部入金",
  "按历史报价加不利滑点模拟成交并扣佣金，缺乏订单簿深度；现金无利息，税费仅限计划所列费用",
  "历史包的来源、可用时刻及完整交易日历需由提供者核实；程序校验不能证明原始数据真实",
];
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const positive = (v) => finite(v) && v > 0 && v <= 1e8;
const stamp = (v) => typeof v === "string" && /(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
const dateOk = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const unavailable = (reasons) => ({ status: "insufficient_history", schema: REPLAY_SCHEMA, reasons, strategies: [], limitations: REPLAY_LIMITATIONS });

export function replayDataRequirements() {
  return ["逐日原始未复权价格、现金分红及完整共同交易日历", "每次决策前已发布的估值/评分/情绪与来源时间戳", "同期可成交报价、溢折价、买卖价差及时间戳", "明确初始持仓/现金/估值价格、外部入金和预先固定参数"];
}

function validate(data) {
  const errors = [];
  if (!data || data.schema !== REPLAY_SCHEMA) return ["缺少符合回放契约的历史包", ...replayDataRequirements()];
  if (!data.plan || !stamp(data.parameters_fixed_at)) errors.push("缺少计划或参数固定时刻（须含时区）");
  const symbols = Object.keys(data.target_weights || {});
  if (!symbols.length || symbols.length > 12 || symbols.some(s => !/^\d{6}$/.test(s) || !positive(data.target_weights[s])) || Math.abs(symbols.reduce((n, s) => n + data.target_weights[s], 0) - 100) > 0.001) errors.push("目标权重须为 1–12 只 ETF 且合计 100%");
  if (data.price_basis !== "raw_with_cash_dividends" || data.dividends_complete !== true || data.calendar_complete !== true || data.corporate_actions_complete !== true || !data.source) errors.push("必须声明可核验来源、原始价格、完整分红/份额变动与共同交易日历；不接受前复权价格冒充可成交价格");
  if (!finite(data.slippage_bps) || data.slippage_bps < 0 || data.slippage_bps > 1000) errors.push("须明确 0–1000 基点的滑点假设");
  const initial = data.initial;
  if (!initial || !stamp(initial.as_of) || !finite(initial.cash) || initial.cash < 0 || initial.cash > 1e9 || symbols.some(s => !finite(initial.holdings?.[s]) || initial.holdings[s] < 0 || initial.holdings[s] > 1e12 || !positive(initial.prices?.[s]))) errors.push("须明确每只 ETF 的初始份额（空仓填 0）、价格与现金");
  if (initial && ["holdings", "prices"].some(key => Object.keys(initial[key] || {}).some(symbol => !symbols.includes(symbol)))) errors.push("初始持仓/价格包含目标集合以外的资产，不能静默丢弃；请完整纳入回放或单独建包");
  for (const key of ["initial_build_started_at", "initial_build_completed_at"]) {
    const value = data.plan?.[key];
    if (value == null || value === "") continue;
    const recorded = dateOk(value) ? Date.parse(`${value}T00:00:00+08:00`) : stamp(value) ? Date.parse(value) : NaN;
    if (!Number.isFinite(recorded) || recorded > Date.parse(initial?.as_of)) errors.push(`${key} 必须是初始持仓快照当时已知的状态，不能来自未来`);
  }
  const days = data.days;
  if (!Array.isArray(days) || days.length < 252 || days.length > 5200) return [...errors, "至少需要 252 个、最多 5200 个共同交易日"];
  let last = "";
  const plan = normalizePlan(data.plan || {});
  for (const day of days) {
    if (!dateOk(day.date) || day.date <= last || !stamp(day.trade_at) || day.trade_at.slice(0, 10) !== day.date || !finite(day.contribution) || day.contribution < 0 || day.contribution > 1e8) {
      errors.push("交易日须严格递增、含同日交易时刻（含时区）和明确非负入金"); break;
    }
    if ([0, 6].includes(new Date(`${day.date}T00:00:00Z`).getUTCDay())) {
      errors.push(`${day.date} 为周末，中国场内 ETF 不可交易`); break;
    }
    const exchangeTime = new Date(Date.parse(day.trade_at) + 8 * 3600000).toISOString();
    const minutes = Number(exchangeTime.slice(11, 13)) * 60 + Number(exchangeTime.slice(14, 16));
    if (exchangeTime.slice(0, 10) !== day.date || !((minutes >= 570 && minutes <= 690) || (minutes >= 780 && minutes <= 900))) {
      errors.push(`${day.date} 决策时刻不在中国场内 ETF 日间交易时段`); break;
    }
    last = day.date;
    for (const s of symbols) {
      const row = day.assets?.[s];
      const a = row?.analysis;
      const q = row?.quote;
      const pq = q?.product_quality;
      if (!positive(row?.close) || !positive(row?.share_factor) || !finite(row?.cash_dividend) || row.cash_dividend < 0 || !positive(q?.price) || !stamp(q?.market_timestamp) || Date.parse(q.market_timestamp) > Date.parse(day.trade_at) || !finite(pq?.premium_discount_pct) || !finite(pq?.bid_ask_spread_pct) || pq.bid_ask_spread_pct < 0 || !row?.source) {
        errors.push(`${day.date} ${s} 缺少可交易报价/溢价/价差/分红或来源`); break;
      }
      if (!a || !stamp(a.observed_at) || !stamp(a.available_at) || Date.parse(a.observed_at) > Date.parse(a.available_at) || Date.parse(a.available_at) >= Date.parse(day.trade_at) || a.point_in_time !== true || !a.source || !a.assetClass || !a.indexCode || a.analyzed !== true) {
        errors.push(`${day.date} ${s} 缺少决策前可用的原时点分析；禁止用当前分析回填`); break;
      }
      const strategy = plan.strategy_overrides?.[s] || plan.strategy;
      if (strategy !== "fixed" && strategy !== "rebalance" && (!finite(a.pePct) || a.pePct < 0 || a.pePct > 1 || !finite(a.spreadPct) || a.spreadPct < 0 || a.spreadPct > 1 || !finite(a.biasPct) || !["A", "B", "C", "D", "E"].includes(a.grade))) {
        errors.push(`${day.date} ${s} 缺少完整原时点估值/评分/利差/技术信号`); break;
      }
      if (strategy !== "fixed" && strategy !== "rebalance" && ["commodity", "bond"].includes(a.assetClass)) {
        errors.push(`${s} 的非股票策略历史契约尚未覆盖，停止完整策略验证`); break;
      }
    }
    const indexCounts = {};
    for (const s of symbols) { const code = day.assets?.[s]?.analysis?.indexCode; indexCounts[code] = (indexCounts[code] || 0) + 1; }
    if (symbols.some(s => { const a = day.assets?.[s]?.analysis; return indexCounts[a?.indexCode] > 1 && (!finite(a?.annual_fee_pct) || a.annual_fee_pct < 0 || !finite(a?.fund_size_yi) || a.fund_size_yi < 0); })) errors.push(`${day.date} 同指数品种缺少原时点费率/规模，不能重放择优规则`);
    if (plan.strategy_config?.sentiment?.enabled) {
      const sentiment = day.sentiment;
      if (!sentiment || !stamp(sentiment.observed_at) || !stamp(sentiment.available_at) || Date.parse(sentiment.observed_at) > Date.parse(sentiment.available_at) || Date.parse(sentiment.available_at) >= Date.parse(day.trade_at) || sentiment.point_in_time !== true || !sentiment.source || !sentiment.by_market || [...new Set(symbols.map(s => sentimentMarketForHolding(day.assets?.[s]?.analysis || {}, plan.strategy_config.sentiment)).filter(Boolean))].some(m => !finite(sentiment.by_market[m]?.score) || sentiment.by_market[m].score < 0 || sentiment.by_market[m].score > 100 || sentiment.by_market[m]?.degraded !== false)) errors.push(`${day.date} 缺少原时点完整情绪数据`);
    }
    if (errors.length > 12) break;
  }
  if (Date.parse(days[0].trade_at) - Date.parse(initial?.as_of) > 15 * 86400000) errors.push("初始估值距离首个交易日超过 15 天，缺失期间不能冒充完整日频回放");
  const startingValue = initial?.cash + symbols.reduce((n, s) => n + initial?.holdings?.[s] * initial?.prices?.[s], 0);
  if (!(startingValue + days.reduce((n, day) => n + day.contribution, 0) > 0)) errors.push("没有初始资产或实际入金，不能计算投资收益率");
  if (Date.parse(data.parameters_fixed_at) >= Date.parse(days[0].trade_at) || Date.parse(initial?.as_of) >= Date.parse(days[0].trade_at)) errors.push("参数与初始持仓的记录时刻必须早于首个交易日");
  if (Date.parse(days.at(-1).trade_at) - Date.parse(days[0].trade_at) < 365 * 86400000) errors.push("共同历史至少须跨越一年，不能以密集观测冒充长期验证");
  return errors;
}

function metrics(rows, startAt) {
  let nav = 1, peak = 1, drawdown = 0;
  for (const row of rows) { nav *= row.daily_factor; peak = Math.max(peak, nav); drawdown = Math.max(drawdown, 1 - nav / peak); }
  const years = (Date.parse(rows.at(-1).at) - Date.parse(startAt)) / (365 * 86400000);
  return { observations: rows.length, start: rows[0].date, end: rows.at(-1).date,
    annualized_return_pct: years > 0 ? (nav ** (1 / years) - 1) * 100 : null,
    total_return_pct: (nav - 1) * 100, max_drawdown_pct: drawdown * 100,
    fees: rows.reduce((n, r) => n + r.fees, 0), slippage_cost: rows.reduce((n, r) => n + r.slippage_cost, 0),
    average_cash_ratio_pct: rows.reduce((n, r) => n + r.cash_ratio_pct, 0) / rows.length,
    final_equity: rows.at(-1).equity };
}

function simulate(data, mode) {
  const symbols = Object.keys(data.target_weights);
  let plan = normalizePlan(structuredClone(data.plan));
  if (mode === "fixed") { plan.strategy = "fixed"; plan.strategy_overrides = {}; plan.strategy_config.sentiment.enabled = false; }
  const positions = { ...data.initial.holdings };
  let cash = data.initial.cash;
  let previousEquity = cash + symbols.reduce((n, s) => n + positions[s] * data.initial.prices[s], 0);
  let previousSnapshot = null;
  let lastPeriod = null;
  const curve = [], trades = [], decisions = [];
  for (const day of data.days) {
    // The engine uses local calendar dates; translate timestamps by the same offset, preserving quote age.
    const calendarNow = new Date(`${day.date}T12:00:00`);
    const now = calendarNow;
    const timeOffset = now.getTime() - Date.parse(day.trade_at);
    const quotes = Object.fromEntries(symbols.map(s => [s, { ...day.assets[s].quote,
      market_timestamp: new Date(Date.parse(day.assets[s].quote.market_timestamp) + timeOffset).toISOString() }]));
    for (const s of symbols) positions[s] *= day.assets[s].share_factor;
    const period = planPeriod(plan, calendarNow);
    const openingDividend = symbols.reduce((n, s) => n + positions[s] * day.assets[s].cash_dividend, 0);
    cash += day.contribution + openingDividend;
    let fees = 0, slippage = 0;
    const quoteValue = symbols.reduce((n, s) => n + positions[s] * day.assets[s].quote.price, 0);
    const rawHoldings = symbols.map(s => ({ ...day.assets[s].analysis, symbol: s, name: s,
      targetWeight: data.target_weights[s], shares: positions[s], marketValue: positions[s] * day.assets[s].quote.price,
      actualWeight: quoteValue > 0 ? positions[s] * day.assets[s].quote.price / quoteValue * 100 : 0,
      tradingPremiumPct: day.assets[s].quote.product_quality.premium_discount_pct,
      tradingSpreadPct: day.assets[s].quote.product_quality.bid_ask_spread_pct }));
    const registry = Object.fromEntries(symbols.map(s => [s, { index_code: day.assets[s].analysis.indexCode }]));
    const products = Object.fromEntries(symbols.map(s => [s, { annual_fee_pct: day.assets[s].analysis.annual_fee_pct, fund_size_yi: day.assets[s].analysis.fund_size_yi }]));
    const { holdings } = applyIndexExposureGroups(rawHoldings, { analysisRegistry: registry, products });
    if (day.date >= period.scheduled && lastPeriod !== period.start) {
      plan = stampInitialBuildStarted(plan, calendarNow).plan;
      const execution = planExecutionContext({ plan, holdings: rawHoldings, now: calendarNow });
      if (execution.reached && !plan.initial_build_completed_at) plan.initial_build_completed_at = day.date;
      plan.cash_reserve = { ...plan.cash_reserve, balance: Math.max(0, cash - execution.budget) };
      const sentiment = day.sentiment?.by_market || {};
      const snapshot = buildSignalSnapshot({ plan, period: period.start, holdings: rawHoldings, previousSnapshot, sentimentByMarket: sentiment, now });
      const tradePlan = buildTradePlan({ plan, holdings, now, phase: execution.phase,
        quotes,
        sentimentByMarket: sentiment, analysisRegistry: { ...registry, __products: products },
        signalSnapshotId: snapshot.id, strategyFrozenBySymbol: snapshot.holdings });
      decisions.push({ date: day.date, phase: execution.phase, summary: tradePlan.summary,
        blocked: [...tradePlan.buyDrafts, ...tradePlan.sellDrafts].filter(d => d.readiness_status !== "ready").map(d => ({ symbol: d.symbol, reasons: d.readiness_reasons })) });
      for (const draft of [...tradePlan.sellDrafts, ...tradePlan.buyDrafts]) {
        if (draft.readiness_status !== "ready" || !(draft.shares > 0)) continue;
        const sell = draft.side === "sell";
        const price = draft.price * (1 + (sell ? -1 : 1) * data.slippage_bps / 10000);
        let shares, fee;
        if (sell) {
          shares = Math.min(positions[draft.symbol], draft.shares);
          fee = Math.round(Math.max(plan.trading_cost.min_commission, shares * price * plan.trading_cost.commission_rate_pct / 100) * 100) / 100;
          if (fee >= shares * price || (plan.trading_cost.max_fee_ratio_pct > 0 && fee / (shares * price) * 100 > plan.trading_cost.max_fee_ratio_pct)) continue;
        } else {
          // The draft cash is already rounded down to whole lots at the
          // pre-slippage quote. Re-size against the original strategic budget;
          // otherwise even one tick of slippage can erase a valid board lot.
          const gapCap = execution.phase === "initial" ? draft.decision_snapshot.target_gap : Infinity;
          const preview = orderPreview(Math.min(cash, draft.suggested_amount, gapCap), price, plan.trading_cost);
          shares = Math.min(draft.shares, preview.shares);
          fee = Math.round(Math.max(plan.trading_cost.min_commission, shares * price * plan.trading_cost.commission_rate_pct / 100) * 100) / 100;
        }
        if (!(shares > 0)) continue;
        cash += sell ? shares * price - fee : -shares * price - fee;
        positions[draft.symbol] += sell ? -shares : shares;
        fees += fee; slippage += shares * Math.abs(price - draft.price);
        trades.push({ date: day.date, symbol: draft.symbol, side: draft.side, shares, price, fee });
      }
      previousSnapshot = snapshot; lastPeriod = period.start;
    }
    const equity = cash + symbols.reduce((n, s) => n + positions[s] * day.assets[s].close, 0);
    const denominator = previousEquity + day.contribution;
    curve.push({ date: day.date, at: day.trade_at, equity, cash, daily_factor: denominator > 0 ? equity / denominator : 1,
      contribution: day.contribution, dividends: openingDividend, fees, slippage_cost: slippage, cash_ratio_pct: equity > 0 ? cash / equity * 100 : 100 });
    previousEquity = equity;
  }
  const split = Math.floor(curve.length * 0.7);
  return { id: mode, ...metrics(curve, data.initial.as_of),
    calibration: metrics(curve.slice(0, split), data.initial.as_of),
    holdout: metrics(curve.slice(split), curve[split - 1].at), curve, trades, decisions };
}

export function runStrategyReplay(data) {
  try {
    const reasons = validate(data);
    if (reasons.length) return unavailable(reasons);
    const strategies = [simulate(data, "configured"), simulate(data, "fixed")];
    if (strategies.some(s => !finite(s.annualized_return_pct) || s.curve.some(r => !finite(r.equity) || r.cash < -0.01))) return unavailable(["模拟出现无效净值或资金透支，停止输出收益"]);
    return { status: "ready", schema: REPLAY_SCHEMA, strategies, limitations: REPLAY_LIMITATIONS,
      methodology: { engine: "buildTradePlan/buildSignalSnapshot", split: "chronological_70_30", chronological_holdout: true,
        out_of_sample: false, parameter_optimization: false, future_target_validated: false, frequency: "daily",
        price_basis: data.price_basis, parameter_fingerprint: JSON.stringify({ plan: normalizePlan(data.plan), target_weights: data.target_weights, slippage_bps: data.slippage_bps }), slippage_bps: data.slippage_bps, parameters_fixed_at: data.parameters_fixed_at },
      holdout_excess_return_pp: strategies[0].holdout.annualized_return_pct - strategies[1].holdout.annualized_return_pct };
  } catch { return unavailable(["历史包格式或参数不完整，无法安全回放", ...replayDataRequirements()]); }
}

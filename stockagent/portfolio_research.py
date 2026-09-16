"""只读价格基准研究：数据覆盖、完整月度窗口、固定参数滚动比较。"""

import calendar
from concurrent.futures import ThreadPoolExecutor
import datetime as dt
import math
import re
import statistics
import threading
import time
from collections import defaultdict, deque

from .investment_goal import normalize_investment_goal
from .portfolio_backtest import MAX_VALID_PRICE, MIN_VALID_PRICE, run_strategy, valid_date
from .quotes import get_price_history

MIN_OBSERVATIONS = 37  # 36 个持有期，不能用 36 个观测冒充三年
MAX_OBSERVATIONS = 181
MAX_HISTORY_ROWS = 5_200
MAX_CONCURRENT_RESEARCH = 2
MAX_REQUESTS_PER_MINUTE = 6
MODES = ("fixed", "cashflow", "rebalance")
_RESEARCH_SLOTS = threading.BoundedSemaphore(MAX_CONCURRENT_RESEARCH)
_RATE_LOCK = threading.Lock()
_RATE_STARTS = defaultdict(deque)
LIMITATIONS = [
    "这是固定参数价格基准研究，不是工作区完整策略，也不是样本外检验或未来收益预测",
    "来源可能使用原始或前复权收盘价，含分红总回报口径未核验；不补造上市前数据或拼接指数代理",
    "月度净值可能遗漏月内回撤；未模拟历史溢价、价差、滑点、税费或现金利息",
    "每个窗口从空仓开始按月投入，未使用真实持仓；剩余现金结转并可用于后续买入",
    "滚动窗口相互重叠，历史达标占比不是未来达标概率；没有自动挑选最优参数",
]


def _number(value):
    if isinstance(value, bool) or value is None:
        raise ValueError("需要有效数值")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("需要有限数值")
    return number


def _request(payload):
    if not isinstance(payload, dict):
        raise ValueError("请求必须为对象")
    raw = payload.get("target_weights")
    if not isinstance(raw, dict):
        raise ValueError("请提供 1–12 只 ETF 的目标权重")
    weights = {}
    for symbol, value in raw.items():
        if not re.fullmatch(r"[0-9]{6}", str(symbol)):
            raise ValueError("ETF 代码必须为六位数字")
        weight = _number(value)
        if not 0 <= weight <= 100:
            raise ValueError("目标权重须在 0–100% 之间")
        if weight > 0:
            weights[symbol] = weight
    if not 1 <= len(weights) <= 12:
        raise ValueError("请提供 1–12 只正权重 ETF")
    if abs(sum(weights.values()) - 100) >= 0.01:
        raise ValueError("目标权重须合计 100%，不会自动归一化")
    budget = _number(payload.get("monthly_budget"))
    if not 0 < budget <= 100_000_000:
        raise ValueError("月度研究预算须大于 0 且不超过一亿元")
    raw_cost = payload.get("trading_cost", {})
    if not isinstance(raw_cost, dict):
        raise ValueError("交易费用必须为对象")
    cost = {}
    for key, default, maximum in (("lot_size", 100, 100000), ("min_commission", 5, 100000),
                                  ("commission_rate_pct", 0.03, 100), ("max_fee_ratio_pct", 0.25, 100)):
        value = _number(raw_cost.get(key, default))
        if not 0 <= value <= maximum or (key == "lot_size" and (value < 1 or int(value) != value)):
            raise ValueError(f"交易费用参数无效：{key}")
        cost[key] = value
    explicit = payload.get("price_history")
    if explicit is not None:
        if not isinstance(explicit, dict):
            raise ValueError("price_history 必须按 ETF 代码分组")
        unknown = set(explicit) - set(weights)
        if unknown:
            raise ValueError("price_history 只能包含当前正权重 ETF")
        for symbol, rows in explicit.items():
            if not isinstance(rows, list):
                raise ValueError(f"{symbol} 的 price_history 必须为数组")
            if len(rows) > MAX_HISTORY_ROWS:
                raise ValueError(f"{symbol} 的历史记录不能超过 {MAX_HISTORY_ROWS} 条")
    return weights, budget, cost, normalize_investment_goal(payload.get("investment_goal"))


def _rate_allowed(key, now=None):
    if key is None:
        return True
    now = time.monotonic() if now is None else now
    with _RATE_LOCK:
        starts = _RATE_STARTS[key]
        while starts and now - starts[0] >= 60:
            starts.popleft()
        if len(starts) >= MAX_REQUESTS_PER_MINUTE:
            return False
        starts.append(now)
        return True


def _clean_history(symbol, response, cutoff):
    if not isinstance(response, dict):
        response = {"error": "历史接口返回无效"}
    rows = response.get("points")
    if not isinstance(rows, list):
        rows = []
    closes, invalid, excluded, conflicts = {}, 0, 0, 0
    for row in rows:
        if not isinstance(row, dict):
            invalid += 1
            continue
        day = row.get("date")
        try:
            close = _number(row.get("close"))
        except (TypeError, ValueError, OverflowError):
            invalid += 1
            continue
        if not valid_date(day) or not MIN_VALID_PRICE <= close <= MAX_VALID_PRICE:
            invalid += 1
            continue
        if day > cutoff:
            excluded += 1
            continue
        if day in closes and closes[day] != close:
            conflicts += 1
        closes[day] = close
    dates = sorted(closes)
    coverage = {
        "symbol": symbol, "provider": str(response.get("provider") or "未提供来源"),
        "start": dates[0] if dates else None, "end": dates[-1] if dates else None,
        "months": len({day[:7] for day in dates}), "observations": len(dates),
        "invalid_rows": invalid, "excluded_rows": excluded, "conflicting_dates": conflicts,
        "error": str(response.get("error") or ""),
        "fetched_at": str(response.get("updated_at") or ""),
    }
    return closes, coverage


def _simulate(mode, dates, prices, weights, budget, cost):
    return run_strategy(
        mode=mode, month_dates=dates, prices=prices, pe_series={}, weights=weights,
        monthly_budget=budget, lot_size=int(cost["lot_size"]),
        min_commission=cost["min_commission"], commission_rate=cost["commission_rate_pct"] / 100,
        max_fee_ratio=cost["max_fee_ratio_pct"] / 100, pe_bands=[],
    )


def _rolling(mode, months, dates, prices, weights, budget, cost, target):
    result = {"horizon_months": months, "required_observations": months + 1,
              "available_observations": len(dates), "windows": []}
    if len(dates) <= months:
        return {**result, "status": "insufficient_history", "count": 0}
    for start in range(len(dates) - months):
        window = dates[start:start + months + 1]
        metrics = _simulate(mode, window, prices, weights, budget, cost)
        result["windows"].append({"start": window[0], "end": window[-1], **metrics})
    returns = [item["annualized_return_pct"] for item in result["windows"]]
    return {**result, "status": "ready", "count": len(returns),
            "min_return_pct": min(returns), "median_return_pct": statistics.median(returns),
            "max_return_pct": max(returns),
            "target_hit_pct": round(sum(value >= target for value in returns) / len(returns) * 100, 2) if target is not None else None}


def _run_portfolio_research(payload, *, history_loader=None, today=None):
    """显式历史用于可复现测试；在线路径仅向已有行情服务传代码，不写工作区。"""
    try:
        weights, budget, cost, goal = _request(payload)
    except (ValueError, TypeError, OverflowError) as exc:
        return 400, {"status": "invalid_request", "limitations": [str(exc)]}
    today = today or dt.date.today()
    cutoff = (today.replace(day=1) - dt.timedelta(days=1)).isoformat()
    explicit = payload.get("price_history")
    loader = history_loader or get_price_history

    def load(symbol):
        if explicit is not None:
            return symbol, {"points": explicit.get(symbol, []), "provider": "调用方提供"}
        try:
            return symbol, loader(symbol, market="A", range_key="max")
        except Exception:
            return symbol, {"points": [], "error": "历史行情拉取失败，请稍后重试"}

    with ThreadPoolExecutor(max_workers=min(4, len(weights))) as pool:
        responses = dict(pool.map(load, weights))
    prices, coverage = {}, []
    for symbol in weights:
        closes, report = _clean_history(symbol, responses[symbol], cutoff)
        prices[symbol] = closes
        coverage.append(report)
    common_dates = sorted(set.intersection(*(set(series) for series in prices.values())))
    by_month = {day[:7]: day for day in common_dates}
    dates = list(by_month.values())[-MAX_OBSERVATIONS:]
    reasons = []
    if any(row["conflicting_dates"] for row in coverage):
        reasons.append("同一日期存在冲突价格，停止比较")
    if len(dates) < MIN_OBSERVATIONS:
        reasons.append(f"共同完整月度观测仅 {len(dates)} 个，基础研究至少需要 {MIN_OBSERVATIONS} 个")
    month_numbers = [int(day[:4]) * 12 + int(day[5:7]) for day in dates]
    if any(cur - prev != 1 for prev, cur in zip(month_numbers, month_numbers[1:])):
        reasons.append("共同月度行情存在缺口，不前向填充或跳月计算")
    if any(calendar.monthrange(int(day[:4]), int(day[5:7]))[1] - int(day[8:]) > 10 for day in dates):
        reasons.append("部分月份仅有过早报价，无法作为月末观测")
    base = {"status": "insufficient_history" if reasons else "ready", "cutoff": cutoff,
            "required_observations": MIN_OBSERVATIONS, "observations": len(dates),
            "coverage": coverage, "goal": goal, "target_weights": weights,
            "price_history": {symbol: [{"date": day, "close": prices[symbol][day]} for day in dates] for symbol in weights},
            "monthly_budget": budget, "trading_cost": cost,
            "limitations": reasons + LIMITATIONS, "strategies": [],
            "methodology": {"return_basis": "time_weighted_net_of_trading_fees", "annualization_basis": "ACT/365",
                            "observation_frequency": "monthly", "price_basis": "provider_dependent_close_unverified",
                            "out_of_sample": False, "future_target_validated": False}}
    if reasons:
        return 422, base
    horizons = {36, 60, 120}
    goal_months = math.ceil(goal["horizon_years"] * 12) if goal["horizon_years"] is not None else None
    if goal_months:
        horizons.add(goal_months)
    try:
        for mode in MODES:
            metrics = _simulate(mode, dates, prices, weights, budget, cost)
            rolling = [_rolling(mode, months, dates, prices, weights, budget, cost, goal["annual_return_target_pct"])
                       for months in sorted(horizons)]
            base["strategies"].append({"id": mode, "status": "ready", **metrics, "rolling": rolling})
    except (ArithmeticError, ValueError):
        base["status"] = "insufficient_history"
        base["strategies"] = []
        base["limitations"] = ["历史价格无法生成有限且可复现的模拟结果", *base["limitations"]]
        return 422, base
    base.update({"start": dates[0], "end": dates[-1],
                 "goal_horizon_months": goal_months,
                 "goal_horizon_status": "not_configured" if goal_months is None else
                    "insufficient_history" if len(dates) <= goal_months else "historical_only"})
    return 200, base


def run_portfolio_research(payload, *, history_loader=None, today=None, rate_key=None):
    """Bound expensive research work across concurrent HTTP requests."""
    if not _rate_allowed(rate_key):
        return 429, {"status": "busy", "limitations": ["研究请求过于频繁，请一分钟后重试"]}
    if not _RESEARCH_SLOTS.acquire(blocking=False):
        return 429, {"status": "busy", "limitations": ["已有研究任务运行中，请稍后重试"]}
    try:
        return _run_portfolio_research(payload, history_loader=history_loader, today=today)
    finally:
        _RESEARCH_SLOTS.release()

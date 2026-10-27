"""Read-only daily DCA vs drawdown simulation with identical external cash flows."""

import datetime as dt
import math
from concurrent.futures import ThreadPoolExecutor

from .portfolio_backtest import _lot_buy, _xirr
from .portfolio_research import _clean_history, _number, _request, _rate_allowed, _RESEARCH_SLOTS
from .quotes import get_price_history

MIN_DAYS = 60
LIMITATIONS = [
    "按所选组合比例从空仓开始，模拟新增投入；不是实际账户收益，也不把今天的持仓倒填到历史。",
    "这是价格历史模拟。数据源可能提供原始或前复权价格，分红总回报口径未核验；除息可能影响回撤信号，复权价格下份额及费用仅为近似。",
    "按收盘价成交并扣佣金，未模拟历史溢价限制、价差、滑点、停牌、税费及现金利息；不在期末强制卖出。",
    "回撤相对模拟开始以来的收盘高点，每加深一个档距可买一次；创出新高后重置，同档不重复。跳过多档时仅买一笔，不追补。",
    "回撤信号取上一共同交易日，下一共同交易日收盘模拟成交；若资金或整手/费用条件不满足，只有仍处在未买档位时才重试。",
    "两策略按相同日期、相同金额入金，按组合比例分别留存现金，ETF 之间不挪用。逢低每笔最多用该 ETF 一期额度，定投在周期首个交易日使用其累计可用现金。",
    "收益和回撤均包含闲置现金。历史胜出不等于未来更优；反复调参挑选最好结果会产生过拟合。",
]


def _period(day, cadence):
    date = dt.date.fromisoformat(day)
    return day[:7] if cadence == "monthly" else date.isocalendar()[:2]


def simulate(mode, dates, prices, weights, budget, cadence, dip_pct, initial_cash, cost):
    """Pure deterministic engine; previous close is the only drawdown signal."""
    sleeves = {s: {"cash": 0.0, "shares": 0, "fees": 0.0, "peak": 0.0,
                   "tier": 0, "trades": [], "nav": 1.0, "nav_peak": 1.0,
                   "max_dd": 0.0, "equity": 0.0, "capital": 0.0,
                   "blocked_days": 0} for s in weights}
    curve, contributions, trades = [], [], []
    prev_equity, nav, nav_peak, max_dd = 0.0, 1.0, 1.0, 0.0
    previous_period = None
    for index, day in enumerate(dates):
        period = _period(day, cadence)
        funding_day = period != previous_period
        deposit = (budget if funding_day else 0) + (initial_cash if index == 0 else 0)
        contributions.append(deposit)
        for symbol, weight in weights.items():
            account = sleeves[symbol]
            flow = deposit * weight / 100
            account["cash"] += flow
            account["capital"] += flow
            tier, signal_date = 0, None
            if index:
                signal_date = dates[index - 1]
                close = prices[symbol][signal_date]
                if close > account["peak"]:
                    account["peak"], account["tier"] = close, 0
                drawdown = max(0, (1 - close / account["peak"]) * 100)
                tier = math.floor((drawdown + 1e-9) / dip_pct)
            buy = funding_day if mode == "periodic" else tier > account["tier"]
            if buy:
                cash = account["cash"] if mode == "periodic" else min(account["cash"], budget * weight / 100)
                qty, amount, fee = _lot_buy(cash, prices[symbol][day], int(cost["lot_size"]),
                                           cost["min_commission"], cost["commission_rate_pct"] / 100,
                                           cost["max_fee_ratio_pct"] / 100)
                # Rounded settlement must also fit the actual available cash.
                if qty and amount + fee <= cash + 1e-8:
                    account["cash"] = max(0, account["cash"] - amount - fee)
                    account["shares"] += qty
                    account["fees"] += fee
                    account["tier"] = tier
                    trade = {"date": day, "symbol": symbol, "shares": qty, "price": prices[symbol][day],
                             "amount": amount, "fee": fee, "signal_date": signal_date if mode == "dip" else None,
                             "drawdown_tier": tier if mode == "dip" else None}
                    account["trades"].append(trade)
                    trades.append(trade)
                else:
                    account["blocked_days"] += 1
            equity = account["cash"] + account["shares"] * prices[symbol][day]
            base = account["equity"] + flow
            account["nav"] *= equity / base if base else 1
            account["nav_peak"] = max(account["nav_peak"], account["nav"])
            account["max_dd"] = max(account["max_dd"], 1 - account["nav"] / account["nav_peak"])
            account["equity"] = equity
        equity = sum(a["equity"] for a in sleeves.values())
        nav *= equity / (prev_equity + deposit) if prev_equity + deposit else 1
        nav_peak = max(nav_peak, nav)
        max_dd = max(max_dd, 1 - nav / nav_peak)
        curve.append({"date": day, "equity": round(equity, 2), "nav": round(nav, 8),
                      "capital": round(sum(a["capital"] for a in sleeves.values()), 2)})
        prev_equity, previous_period = equity, period
    capital = sum(contributions)
    years = (dt.date.fromisoformat(dates[-1]) - dt.date.fromisoformat(dates[0])).days / 365
    xirr = _xirr(dates, contributions, equity) if years >= 1 else None
    rows = []
    for symbol, a in sleeves.items():
        profit = a["equity"] - a["capital"]
        rows.append({"symbol": symbol, "weight": weights[symbol], "contributed_capital": round(a["capital"], 2),
                     "ending_value": round(a["equity"], 2), "net_profit": round(profit, 2),
                     "profit_on_capital_pct": round(profit / a["capital"] * 100, 4),
                     "max_drawdown_pct": round(a["max_dd"] * 100, 4),
                     "ending_cash": round(a["cash"], 2), "fees": round(a["fees"], 2),
                     "trade_count": len(a["trades"]), "blocked_days": a["blocked_days"]})
    return {"id": mode, "contributed_capital": round(capital, 2), "ending_value": round(equity, 2),
            "net_profit": round(equity - capital, 2), "profit_on_capital_pct": round((equity / capital - 1) * 100, 4),
            "time_weighted_return_pct": round((nav - 1) * 100, 4),
            "annualized_return_pct": round((nav ** (1 / years) - 1) * 100, 4) if years >= 1 else None,
            "money_weighted_return_pct": round(xirr * 100, 4) if xirr is not None else None,
            "max_drawdown_pct": round(max_dd * 100, 4), "fees": round(sum(a["fees"] for a in sleeves.values()), 2),
            "ending_cash": round(sum(a["cash"] for a in sleeves.values()), 2),
            "trade_count": len(trades), "etfs": rows, "curve": curve, "trades": trades}


def _run(payload, history_loader=None, today=None):
    try:
        if not isinstance(payload, dict):
            raise ValueError("请求必须为对象")
        weights, budget, cost, _ = _request({**payload, "monthly_budget": payload.get("budget")})
        # Remove sub-cent percentage rounding differences so both books receive
        # exactly the external deposits used by the return calculations.
        total_weight = sum(weights.values())
        weights = {symbol: weight * (100 / total_weight) for symbol, weight in weights.items()}
        if budget < 1 or any(budget * weight / 100 < 0.01 for weight in weights.values()):
            raise ValueError("每期投入至少 1 元，且每只 ETF 分配到的金额至少 0.01 元")
        cadence = payload.get("cadence", "monthly")
        dip_pct = _number(payload.get("dip_pct", 5))
        initial_cash = _number(payload.get("initial_cash", 0))
        years = _number(payload.get("years", 3))
        if cadence not in ("monthly", "weekly"):
            raise ValueError("请选择每月或每周")
        if not 1 <= dip_pct <= 50 or not 0 <= initial_cash <= 100_000_000:
            raise ValueError("回撤档距须为 1–50%，起始现金须为 0–1 亿元")
        if years not in (0, 1, 3, 5, 10):
            raise ValueError("历史区间须为 1、3、5、10 年或全部")
    except (ValueError, TypeError, OverflowError) as exc:
        return 400, {"status": "invalid_request", "limitations": [str(exc)]}
    today = today or dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).date()
    cutoff = (today - dt.timedelta(days=1)).isoformat()
    start = (today - dt.timedelta(days=int(years * 365.25))).isoformat() if years else "0001-01-01"
    explicit = payload.get("price_history")
    loader = history_loader or get_price_history

    def load(symbol):
        if explicit is not None:
            return symbol, {"points": explicit.get(symbol, []), "provider": "调用方提供"}
        try:
            return symbol, loader(symbol, market="A", range_key="max")
        except Exception:
            return symbol, {"error": "历史行情拉取失败，请稍后重试"}

    with ThreadPoolExecutor(max_workers=min(4, len(weights))) as pool:
        responses = dict(pool.map(load, weights))
    prices, coverage = {}, []
    for symbol, response in responses.items():
        closes, report = _clean_history(symbol, response, cutoff)
        prices[symbol] = {d: p for d, p in sorted(closes.items())[-5200:] if d >= start}
        coverage.append(report)
    dates = sorted(set.intersection(*(set(p) for p in prices.values())))
    base = {"status": "insufficient_history", "coverage": coverage, "observations": len(dates),
            "cutoff": cutoff, "requested_start": start if years else None, "strategies": [],
            "limitations": list(LIMITATIONS), "warnings": []}
    problems = []
    if any(r["invalid_rows"] or r["conflicting_dates"] for r in coverage):
        problems.append("历史存在无效或冲突价格，暂不生成模拟收益。")
    if len(dates) < MIN_DAYS:
        problems.append(f"至少需要 {MIN_DAYS} 个共同交易日，当前仅 {len(dates)} 个。请延长区间或检查 ETF 数据来源。")
    if dates:
        shared = set(dates)
        if any({d for d in p if dates[0] <= d <= dates[-1]} != shared for p in prices.values()):
            problems.append("共同区间中有 ETF 缺少交易日，无法可靠比较日度回撤。")
        gaps = [(dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days for a, b in zip(dates, dates[1:])]
        if gaps and (max(gaps) > 14 or sum(gaps) / len(gaps) > 3):
            problems.append("历史过于稀疏或中间存在长缺口，不能当作连续日行情。")
    if problems:
        base["limitations"] = problems + base["limitations"]
        return 422, base
    base.update({"status": "ready", "start": dates[0], "end": dates[-1],
                 "budget": budget, "cadence": cadence, "dip_pct": dip_pct,
                 "initial_cash": initial_cash, "trading_cost": cost, "target_weights": weights})
    if years and (dt.date.fromisoformat(dates[0]) - dt.date.fromisoformat(start)).days > 14:
        base["warnings"].append("部分 ETF 可用历史较短，已缩短到全部 ETF 共同覆盖的区间，没有补造上市前数据。")
    if (today - dt.date.fromisoformat(dates[-1])).days > 14:
        base["warnings"].append("历史末日距今超过 14 天，请留意数据更新情况。")
    if (dt.date.fromisoformat(dates[-1]) - dt.date.fromisoformat(dates[0])).days < 365:
        base["warnings"].append("样本不足一年，仅展示区间收益，不外推年化。")
    base["strategies"] = [simulate(mode, dates, prices, weights, budget, cadence, dip_pct, initial_cash, cost)
                          for mode in ("periodic", "dip")]
    return 200, base


def run_strategy_simulation(payload, *, history_loader=None, today=None, rate_key=None):
    if not _rate_allowed(rate_key) or not _RESEARCH_SLOTS.acquire(blocking=False):
        return 429, {"status": "busy", "limitations": ["已有模拟运行或请求过于频繁，请稍后重试。"]}
    try:
        return _run(payload, history_loader=history_loader, today=today)
    except (ValueError, OverflowError):
        return 422, {"status": "invalid_history", "limitations": ["历史价格无法生成有效模拟结果，请检查数据来源。"]}
    finally:
        _RESEARCH_SLOTS.release()

#!/usr/bin/env python3
"""组合历史回测（标准库）：fixed / rebalance / current。

信号必须早于交易日。基础策略仅依赖价格，估值策略单独检查历史覆盖。
收益采用扣费后时间加权净值；本金、盈亏、XIRR 单列。
"""

from __future__ import annotations

import datetime
import math
from typing import Dict, List, Tuple


MIN_MONTHS = 36


def _round2(value: float) -> float:
    return round(float(value) + 1e-12, 2)


def _round4(value: float) -> float:
    return round(float(value) + 1e-12, 4)


def _valid_date(value):
    try:
        return datetime.date.fromisoformat(value).isoformat() == value
    except (ValueError, TypeError):
        return False


def _cost_value(config, key, default):
    value = config.get(key)
    if value is None:
        return default
    try:
        number = float(value)
        return number if math.isfinite(number) and number >= 0 else default
    except (ValueError, TypeError):
        return default


def _month_ends(dates: List[str]) -> List[str]:
    """Pick last available trading date in each YYYY-MM."""
    by_month: Dict[str, str] = {}
    for day in dates:
        if len(day) < 7:
            continue
        key = day[:7]
        if key not in by_month or day > by_month[key]:
            by_month[key] = day
    return [by_month[k] for k in sorted(by_month)]


def _lot_buy(cash: float, price: float, lot_size: int, min_commission: float, rate: float, max_fee_ratio: float):
    if not (cash > 0 and price > 0 and lot_size > 0):
        return 0, 0.0, 0.0
    # Largest affordable order; a smaller order cannot improve its fee ratio.
    notional_budget = min(cash / (1 + rate), cash - min_commission)
    affordable = max(0, int(notional_budget // (price * lot_size))) * lot_size
    if affordable >= lot_size:
        notional = affordable * price
        fee = max(min_commission, notional * rate)
        if max_fee_ratio > 0 and notional > 0 and fee / notional > max_fee_ratio + 1e-12:
            return 0, 0.0, 0.0
        if notional + fee <= cash + 1e-9:
            return affordable, _round2(notional), _round2(fee)
    return 0, 0.0, 0.0


def _xirr(dates: List[str], contributions: List[float], ending_value: float):
    """Deposit-only cash flows plus terminal liquidation, ACT/365; no root => None."""
    end = datetime.date.fromisoformat(dates[-1])
    years = [(end - datetime.date.fromisoformat(day)).days / 365.0 for day in dates]
    if not any(amount > 0 and age > 0 for amount, age in zip(contributions, years)):
        return None

    # Solve in log(1+r). Scaling prevents overflow on long histories.
    def balance(log_rate):
        exponents = [log_rate * age for age in years]
        scale = max(0.0, *exponents)
        return sum(amount * math.exp(power - scale)
                   for amount, power in zip(contributions, exponents)) - ending_value * math.exp(-scale)

    low, high = -20.0, 20.0
    if balance(low) >= 0 or balance(high) <= 0:
        return None
    for _ in range(160):
        mid = (low + high) / 2
        if balance(mid) > 0:
            high = mid
        else:
            low = mid
    return math.expm1((low + high) / 2)


def _metrics(equity_curve, performance_curve, dates, contributions, fees, turnover, cash_ratios):
    """performance_curve starts at 1 before the first contribution/trade."""
    end = equity_curve[-1]
    years = (datetime.date.fromisoformat(dates[-1]) - datetime.date.fromisoformat(dates[0])).days / 365.0
    total_return = performance_curve[-1] - 1.0
    ann = (1.0 + total_return) ** (1.0 / years) - 1.0 if years > 0 else None
    peak = 1.0
    max_dd = 0.0
    for value in performance_curve:
        if value > peak:
            peak = value
        if peak > 0:
            max_dd = max(max_dd, (peak - value) / peak)
    # Initial trading fees have no elapsed interval. Fold them into the first
    # observed interval instead of adding a fictitious month to volatility.
    interval_curve = [1.0, *performance_curve[2:]]
    rets = [cur / prev - 1.0 for prev, cur in zip(interval_curve, interval_curve[1:]) if prev > 0]
    vol = 0.0
    if len(rets) > 1:
        mean = sum(rets) / len(rets)
        var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
        vol = math.sqrt(var) * math.sqrt(12)
    avg_cash = sum(cash_ratios) / len(cash_ratios) if cash_ratios else 0.0
    avg_equity = sum(equity_curve) / len(equity_curve)
    turnover_pct = (turnover / avg_equity * 100.0) if avg_equity > 0 else 0.0
    contributed = sum(contributions)
    xirr = _xirr(dates, contributions, end)
    return {
        "ending_value": _round2(end),
        "contributed_capital": _round2(contributed),
        "net_profit": _round2(end - contributed),
        "total_return_pct": _round4(total_return * 100.0),
        "annualized_return_pct": _round4(ann * 100.0) if ann is not None else None,
        "money_weighted_return_pct": _round4(xirr * 100.0) if xirr is not None else None,
        "max_drawdown_pct": _round4(max_dd * 100.0),
        "annualized_volatility_pct": _round4(vol * 100.0),
        "turnover_pct": _round4(turnover_pct),
        "fees": _round2(fees),
        "average_cash_pct": _round4(avg_cash * 100.0),
        "ending_cash_pct": _round4(cash_ratios[-1] * 100.0),
    }


def _run_strategy(
    *,
    mode: str,
    month_dates: List[str],
    prices: Dict[str, Dict[str, float]],
    pe_series: Dict[str, Dict[str, float]],
    weights: Dict[str, float],
    monthly_budget: float,
    lot_size: int,
    min_commission: float,
    commission_rate: float,
    max_fee_ratio: float,
    pe_bands: List[dict],
):
    symbols = [s for s, w in weights.items() if w > 0]
    shares = {s: 0.0 for s in symbols}
    cash = 0.0
    fees = 0.0
    turnover = 0.0
    equity_curve = []
    performance_curve = [1.0]
    cash_ratios = []
    contributions = []
    previous_equity = 0.0

    def pe_mult(symbol: str, day: str) -> float:
        if mode == "fixed":
            return 1.0
        series = pe_series.get(symbol) or {}
        # A closing signal cannot trade at the same day's closing price.
        usable = [d for d in series if d < day]
        if not usable:
            return 0.0
        pe = series[max(usable)]
        pct = pe * 100.0 if pe <= 1 else pe
        for band in pe_bands:
            if pct <= float(band.get("max_pct", 100)):
                return float(band.get("mult", 1) or 0)
        return 0.0

    for day in month_dates:
        # mark-to-market
        values = {}
        total_pos = 0.0
        for symbol in symbols:
            px = prices.get(symbol, {}).get(day)
            if px is None:
                # carry previous if missing
                earlier = [d for d in prices.get(symbol, {}) if d <= day]
                px = prices[symbol][max(earlier)] if earlier else None
            if px is None or px <= 0:
                values[symbol] = 0.0
                continue
            values[symbol] = shares[symbol] * px
            total_pos += values[symbol]
        pre_flow_equity = total_pos + cash
        growth_factor = pre_flow_equity / previous_equity if previous_equity > 0 else 1.0
        cash += monthly_budget
        contributions.append(monthly_budget)
        equity = pre_flow_equity + monthly_budget

        if mode == "rebalance" and total_pos > 0:
            # January-like annual rebalance each year-start month (01)
            if day[5:7] == "01":
                for symbol in symbols:
                    target_w = weights[symbol] / 100.0
                    target_val = equity * target_w
                    px = prices.get(symbol, {}).get(day)
                    if not px:
                        earlier = [d for d in prices.get(symbol, {}) if d <= day]
                        px = prices[symbol][max(earlier)] if earlier else None
                    if not px:
                        continue
                    diff = values[symbol] - target_val
                    if diff > px * lot_size:
                        sell_shares = int(diff / px / lot_size) * lot_size
                        sell_shares = min(sell_shares, int(shares[symbol] // lot_size) * lot_size)
                        if sell_shares > 0:
                            notional = sell_shares * px
                            fee = max(min_commission, notional * commission_rate)
                            if fee >= notional or (max_fee_ratio > 0 and fee / notional > max_fee_ratio):
                                continue
                            shares[symbol] -= sell_shares
                            cash += notional - fee
                            values[symbol] -= notional
                            fees += fee
                            turnover += notional

        # deploy budget by weights * multiplier
        deploy_budget = cash
        if deploy_budget > 0:
            scores = {}
            for symbol in symbols:
                mult = pe_mult(symbol, day) if mode == "current" else 1.0
                if mode in ("rebalance", "cashflow"):
                    # prefer underweight
                    tw = weights[symbol] / 100.0
                    aw = (values[symbol] / equity) if equity > 0 else tw
                    gap = max(0.0, tw - aw)
                    scores[symbol] = gap * mult
                else:
                    scores[symbol] = (weights[symbol] / 100.0) * mult
            score_sum = sum(scores.values())
            if score_sum > 0:
                for symbol in symbols:
                    alloc = deploy_budget * (scores[symbol] / score_sum)
                    px = prices.get(symbol, {}).get(day)
                    if not px:
                        earlier = [d for d in prices.get(symbol, {}) if d <= day]
                        px = prices[symbol][max(earlier)] if earlier else None
                    if not px:
                        continue
                    buy_shares, notional, fee = _lot_buy(
                        alloc, px, lot_size, min_commission, commission_rate, max_fee_ratio
                    )
                    if buy_shares > 0:
                        shares[symbol] += buy_shares
                        cash -= notional + fee
                        fees += fee
                        turnover += notional

        total_pos = 0.0
        for symbol in symbols:
            px = prices.get(symbol, {}).get(day)
            if not px:
                earlier = [d for d in prices.get(symbol, {}) if d <= day]
                px = prices[symbol][max(earlier)] if earlier else None
            if px:
                total_pos += shares[symbol] * px
        post_trade_equity = total_pos + cash
        if equity > 0:
            growth_factor *= post_trade_equity / equity
        performance_curve.append(performance_curve[-1] * growth_factor)
        previous_equity = post_trade_equity
        equity_curve.append(post_trade_equity)
        cash_ratios.append((cash / post_trade_equity) if post_trade_equity > 0 else 1.0)

    return _metrics(equity_curve, performance_curve, month_dates, contributions, fees, turnover, cash_ratios)


def evaluate_backtest_request(payload: dict, *, price_history=None, pe_history=None) -> Tuple[int, dict]:
    """
    price_history: {symbol: [{"date": "YYYY-MM-DD", "close": float}, ...]}
    pe_history: {symbol: [{"date": "YYYY-MM-DD", "as_of": optional date, "pe_percentile": float}, ...]}
    Signal observation AND availability date must be strictly before the trade.
    """
    if not isinstance(payload, dict):
        return 422, {
            "status": "insufficient_history",
            "required_months": MIN_MONTHS,
            "available_by_symbol": {},
            "missing_symbols": [],
            "limitations": ["请求无效"],
        }

    symbols = [str(s).zfill(6)[-6:] for s in (payload.get("symbols") or []) if str(s).strip()]
    weights_raw = payload.get("target_weights") or {}
    weights = {}
    for key, value in weights_raw.items():
        digits = "".join(ch for ch in str(key) if ch.isdigit())
        symbol = digits.zfill(6)
        try:
            w = float(value)
        except (TypeError, ValueError):
            continue
        if len(symbol) == 6 and math.isfinite(w) and w > 0:
            weights[symbol] = w
    if not weights:
        for symbol in symbols:
            weights[symbol] = 0
    target_symbols = [s for s, w in weights.items() if w > 0]
    if not target_symbols:
        return 422, {
            "status": "insufficient_history",
            "required_months": MIN_MONTHS,
            "available_by_symbol": {},
            "missing_symbols": [],
            "limitations": ["缺少目标权重大于 0 的品种"],
        }
    weight_sum = sum(weights.values())
    weights = {symbol: weight / weight_sum * 100.0 for symbol, weight in weights.items()}

    price_history = price_history or {}
    pe_history = pe_history or {}
    available_by_symbol = {}
    missing = []

    prices: Dict[str, Dict[str, float]] = {}
    pe_series: Dict[str, Dict[str, float]] = {}
    month_sets = []

    for symbol in target_symbols:
        rows = price_history.get(symbol) or []
        closes = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            day = str(row.get("date") or "").strip()
            try:
                close = float(row.get("close"))
            except (TypeError, ValueError):
                continue
            if _valid_date(day) and math.isfinite(close) and close > 0:
                closes[day] = close
        months = _month_ends(sorted(closes))
        available_by_symbol[symbol] = len(months)
        if len(months) < MIN_MONTHS:
            missing.append(symbol)
        prices[symbol] = closes
        month_sets.append(set(m[:7] for m in months))

        pe_rows = pe_history.get(symbol) or []
        pe_map = {}
        for row in pe_rows:
            if not isinstance(row, dict):
                continue
            day = str(row.get("date") or row.get("as_of") or "").strip()
            available = str(row.get("as_of") or day).strip()
            try:
                pe = float(row.get("pe_percentile") if row.get("pe_percentile") is not None else row.get("pe_pct"))
            except (TypeError, ValueError):
                continue
            if _valid_date(day) and _valid_date(available) and math.isfinite(pe) and 0 <= pe <= 100:
                pe_map[max(day, available)] = pe
        pe_series[symbol] = pe_map

    if missing:
        return 422, {
            "status": "insufficient_history",
            "required_months": MIN_MONTHS,
            "available_by_symbol": available_by_symbol,
            "missing_symbols": missing,
            "limitations": [
                "任一目标品种历史行情不足 36 个月度观测",
            ],
        }

    common_months = set.intersection(*month_sets) if month_sets else set()
    month_dates = []
    for ym in sorted(common_months):
        # pick min of each symbol's month-end on that ym (aligned)
        candidates = []
        for symbol in target_symbols:
            ends = [d for d in prices[symbol] if d.startswith(ym)]
            if ends:
                candidates.append(max(ends))
        if len(candidates) == len(target_symbols):
            month_dates.append(min(candidates))
    first_common_date = max(min(prices[symbol]) for symbol in target_symbols)
    month_dates = [day for day in month_dates if day >= first_common_date]
    if len(month_dates) < MIN_MONTHS:
        return 422, {
            "status": "insufficient_history",
            "required_months": MIN_MONTHS,
            "available_by_symbol": available_by_symbol,
            "missing_symbols": target_symbols,
            "limitations": ["对齐后的月度观测不足 36"],
        }

    month_dates = month_dates[-60:]
    month_numbers = [int(day[:4]) * 12 + int(day[5:7]) for day in month_dates]
    if any(cur - prev != 1 for prev, cur in zip(month_numbers, month_numbers[1:])):
        return 422, {
            "status": "insufficient_history",
            "required_months": MIN_MONTHS,
            "available_by_symbol": available_by_symbol,
            "missing_symbols": target_symbols,
            "limitations": ["月度行情存在缺口，不能将跨月收益当作单月收益计算波动率"],
        }
    # Require a recent, already-published observation for every simulated trade.
    # A long list of future or same-month records is not historical coverage.
    pe_missing = []
    for symbol in target_symbols:
        for day in month_dates:
            available = [d for d in pe_series[symbol] if d < day]
            if not available or (datetime.date.fromisoformat(day) - datetime.date.fromisoformat(max(available))).days > 45:
                pe_missing.append(symbol)
                break

    trading_cost = payload.get("trading_cost") or {}
    lot_size = max(1, int(_cost_value(trading_cost, "lot_size", 100)))
    min_commission = _cost_value(trading_cost, "min_commission", 5)
    commission_rate = _cost_value(trading_cost, "commission_rate_pct", 0.03) / 100.0
    max_fee_ratio = _cost_value(trading_cost, "max_fee_ratio_pct", 0.25) / 100.0
    monthly_budget = _cost_value(payload, "monthly_budget", 2000.0)
    if not (monthly_budget > 0):
        monthly_budget = 2000.0

    strategy_config = payload.get("strategy_config") or {}
    pe_bands = strategy_config.get("pe_bands") or [
        {"max_pct": 20, "mult": 1.5},
        {"max_pct": 40, "mult": 1.2},
        {"max_pct": 60, "mult": 1.0},
        {"max_pct": 80, "mult": 0.5},
        {"max_pct": 100, "mult": 0},
    ]

    strategies = []
    for mode in ("fixed", "rebalance", "current"):
        if mode == "current" and pe_missing:
            strategies.append({
                "id": mode,
                "status": "insufficient_history",
                "missing_symbols": pe_missing,
                "limitations": ["部分交易日缺少此前 45 日内已公布的 PE 分位，无法验证估值倍率策略"],
            })
            continue
        metrics = _run_strategy(
            mode=mode,
            month_dates=month_dates,
            prices=prices,
            pe_series=pe_series,
            weights=weights,
            monthly_budget=monthly_budget,
            lot_size=lot_size,
            min_commission=min_commission,
            commission_rate=commission_rate,
            max_fee_ratio=max_fee_ratio,
            pe_bands=pe_bands,
        )
        strategies.append({"id": mode, "status": "ready", **metrics})

    return 200, {
        "status": "ready",
        "as_of": month_dates[-1],
        "months": len(month_dates),
        "comparison_complete": not pe_missing,
        "benchmark_id": "fixed",
        "methodology": {
            "return_basis": "time_weighted_net_of_trading_fees",
            "annualization_basis": "ACT/365",
            "money_weighted_basis": "XIRR_ACT/365",
            "observation_frequency": "monthly",
            "volatility_periods_per_year": 12,
            "drawdown_basis": "unitized_nav",
            "price_basis": "supplied_close",
        },
        "strategies": strategies,
        "limitations": [
            "回撤与波动率基于月度净值，可能遗漏月内下跌",
            "收益仅基于传入价格；不自动补计分红、汇率、税费或现金利息",
            "current 仅为 PE 倍率实验，不等同于工作区完整评分、情绪与交易拦截策略",
            "策略参数仍属实验",
            "回测结果不是未来收益预测或最优参数证明",
        ],
    }


def run_backtest_from_workspace_symbols(payload: dict) -> Tuple[int, dict]:
    """API facade: supplied histories only; never manufacture market data."""
    # Prefer explicit histories in payload for tests; production path is conservative.
    if payload.get("price_history") is not None or payload.get("pe_history") is not None:
        return evaluate_backtest_request(
            payload,
            price_history=payload.get("price_history") or {},
            pe_history=payload.get("pe_history") or {},
        )

    # Without injectable history series we cannot guarantee no-lookahead PE.
    symbols = []
    weights = payload.get("target_weights") or {}
    for key, value in weights.items():
        digits = "".join(ch for ch in str(key) if ch.isdigit())
        symbol = digits.zfill(6)
        try:
            w = float(value)
        except (TypeError, ValueError):
            w = 0
        if len(symbol) == 6 and w > 0:
            symbols.append(symbol)
    return 422, {
        "status": "insufficient_history",
        "required_months": MIN_MONTHS,
        "available_by_symbol": {s: 0 for s in symbols},
        "missing_symbols": symbols,
        "limitations": [
            "缺少历史行情；请提供 price_history，估值策略另需 pe_history",
            "策略参数仍属实验",
        ],
    }

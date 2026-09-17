"""Evidence-limited US index drawdown playbook; never submits trades."""

from __future__ import annotations

import datetime
import time

from .dividend_sources import fetch_index_history, fetch_us_treasury_yield_history
from .quotes import get_etf_quotes


INDEXES = {
    "SPX": {"name": "标普500", "symbol": "513500", "market_symbol": "us.INX", "levels": (10, 15, 20, 30)},
    "NDX": {"name": "纳指100", "symbol": "513100", "market_symbol": "us.NDX", "levels": (12, 20, 30, 40)},
}
INDEX_ETFS = {"SPX": ("513500",), "NDX": ("513100", "513390")}
_CACHE = {"payload": None, "expires": 0.0}
MAX_OBSERVATION_AGE_DAYS = 5


def _number(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        result = float(value)
        return result if result == result and abs(result) != float("inf") else None
    except (TypeError, ValueError):
        return None


def _series(rows, key):
    # Distinct valid observation dates, not raw row count, determine history coverage.
    by_date = {}
    for row in rows or []:
        value = _number(row.get(key))
        try:
            date = datetime.date.fromisoformat(str(row.get("date") or "")[:10]).isoformat()
        except ValueError:
            continue
        if value is not None and (key != "close" or value > 0):
            by_date[date] = value
    return sorted(by_date.items())


def _observation_issues(prices, ten, two, today):
    series = {"指数": prices, "10Y": ten, "2Y": two}
    issues = []
    dates = {}
    for name, values in series.items():
        if not values:
            continue
        date = datetime.date.fromisoformat(values[-1][0])
        dates[name] = date
        age = (today - date).days
        if age < 0:
            issues.append(f"{name}最后日期 {date} 晚于评估日期")
        elif age > MAX_OBSERVATION_AGE_DAYS:
            issues.append(f"{name}最后日期 {date} 已超过 {MAX_OBSERVATION_AGE_DAYS} 个日历日")
    if len(dates) == 3 and len(set(dates.values())) != 1:
        issues.append("指数、10Y 与 2Y 最新观测日期不一致，等待同日数据后判断")
    return issues


def _change_bp(series, sessions=20):
    if len(series) <= sessions:
        return None
    return round((series[-1][1] - series[-1 - sessions][1]) * 100, 1)


def _yield_state(ten, two):
    change10 = _change_bp(ten)
    change2 = _change_bp(two)
    if change10 is None:
        trend = "unknown"
    elif change10 >= 30:
        trend = "rapid_rise"
    elif change10 <= -20:
        trend = "falling"
    else:
        trend = "stable"
    return {
        "ten_year_pct": ten[-1][1] if ten else None,
        "two_year_pct": two[-1][1] if two else None,
        "ten_year_change_20_sessions_bp": change10,
        "two_year_change_20_sessions_bp": change2,
        "trend": trend,
        "two_year_trend": "rapid_rise" if change2 is not None and change2 >= 30 else "falling" if change2 is not None and change2 <= -20 else "stable" if change2 is not None else "unknown",
        "as_of": ten[-1][0] if ten else None,
    }


def _premium_execution(premium_pct):
    premium = _number(premium_pct)
    result = {"etf_buy_status": "unknown", "premium_discount_pct": premium,
              "alternative": None}
    if premium is None:
        result.update(etf_buy_status="blocked_missing_premium", alternative="核实实时折溢价；可比较场外 QDII 或等待")
    elif premium >= 5:
        result.update(etf_buy_status="blocked_high_premium", alternative="优先比较场外 QDII 的额度、费用和净值时点，或等待溢价回落")
    elif premium >= 2:
        result.update(etf_buy_status="warning_premium", alternative="优先比较场外 QDII 或等待；场内需经现有执行规则确认")
    else:
        result.update(etf_buy_status="check_execution_policy")
    return result


def judge_index(code, price_rows, treasury_rows, *, premium_pct=None,
                fed_policy=None, earnings_outlook=None, shock=None, today=None):
    """Return a bounded recommendation from observed data and explicit context.

    shock: ``economic_liquidity`` or ``policy`` only when independently verified.
    Missing context remains unknown; a rate move alone cannot prove a crisis.
    """
    as_of_date = datetime.date.fromisoformat(str(today)) if today is not None else datetime.date.today()
    spec = INDEXES[code]
    prices = _series(price_rows, "close")
    ten = _series(treasury_rows, "us10y")
    two = _series(treasury_rows, "us2y")
    rates = _yield_state(ten, two)
    levels = spec["levels"]
    result = {
        "index_code": code, "index_name": spec["name"], "etf_symbol": spec["symbol"],
        "market_state": "insufficient_data", "risk_level": "unknown",
        "suggested_action": "等待指数与利率数据", "trigger_conditions": [],
        "next_add_condition": None, "add_tier": 0, "suggested_intensity": None,
        "tier_purpose": "research_only", "allocation_status": "not_budget_validated",
        "defensive_rebalance": "黄金与红利仓位按既定目标配置和执行页核对",
        "execution": _premium_execution(premium_pct),
        "evidence": {"rates": rates, "index_as_of": prices[-1][0] if prices else None,
                     "recent_high": None, "drawdown_pct": None, "ma120": None,
                     "ma250": None, "fed_policy": fed_policy or "unknown",
                     "earnings_outlook": earnings_outlook or "unknown",
                     "shock": shock or "unknown"},
        "limitations": ["分档与利率阈值为待回测的观察指标",
                         "未接入预留额度与档位消耗记录，不生成加仓比例或防守资产转出建议",
                         "时效采用最多 5 个日历日且最新日期一致的保守检查，未接入交易所节假日日历"],
    }
    issues = _observation_issues(prices, ten, two, as_of_date)
    result["data_quality"] = {"judged_on": as_of_date.isoformat(), "issues": issues,
                              "latest_dates": {"index": prices[-1][0] if prices else None,
                                               "us10y": ten[-1][0] if ten else None,
                                               "us2y": two[-1][0] if two else None}}
    if issues:
        result["suggested_action"] = "等待数据核验：" + "；".join(issues)
        result["limitations"].extend(issues)
        return result
    if len(prices) < 250 or len(ten) < 21 or len(two) < 21:
        result["limitations"].append("需要至少 250 个指数收盘点及 21 个 10Y/2Y 收益率观测")
        return result

    closes = [value for _, value in prices]
    current = closes[-1]
    high = max(closes[-250:])
    if current <= 0 or high <= 0:
        return result
    drawdown = round(max(0.0, (1 - current / high) * 100), 2)
    tier = sum(drawdown >= threshold for threshold in levels)
    ma120 = round(sum(closes[-120:]) / 120, 2)
    ma250 = round(sum(closes[-250:]) / 250, 2)
    evidence = result["evidence"]
    evidence.update({"recent_high": high, "drawdown_pct": drawdown,
                     "ma120": ma120, "ma250": ma250})

    if shock == "policy":
        state = "policy_shock"
    elif shock == "economic_liquidity":
        state = "economic_liquidity_crisis"
    elif rates["trend"] == "rapid_rise" and tier:
        state = "rate_drawdown"
    elif tier:
        state = "drawdown_unclassified"
    else:
        state = "normal_or_watch"
    result["market_state"] = state
    result["risk_level"] = "high" if tier >= 3 or state == "economic_liquidity_crisis" else "medium" if tier or state == "policy_shock" or rates["trend"] == "rapid_rise" or rates["two_year_trend"] == "rapid_rise" else "low"
    result["add_tier"] = tier
    result["trigger_conditions"] = [
        f"{spec['name']}相对近 250 个交易日收盘高点回撤 {drawdown}%",
        f"10Y 近 20 个观测变化 {rates['ten_year_change_20_sessions_bp']}bp；2Y {rates['two_year_change_20_sessions_bp']}bp",
        f"现价{'低于' if current < ma120 else '高于'} MA120，{'低于' if current < ma250 else '高于'} MA250",
    ]
    if shock in ("policy", "economic_liquidity"):
        result["trigger_conditions"].append(f"独立确认冲击：{shock}")
    if earnings_outlook == "deteriorating":
        result["trigger_conditions"].append("盈利预期恶化")
    result["next_add_condition"] = (
        f"回撤达到 {levels[tier]}%，且重新检查 10Y/2Y、盈利与折溢价"
        if tier < len(levels) else "已到最深档；等待利率、盈利与流动性重新评估"
    )
    if not tier:
        result["suggested_action"] = "观察下一档回撤条件，实际交易以执行页为准"
        return result

    result["suggested_action"] = f"第 {tier} 档回撤观察；尚未核验预留额度与档位消耗，实际交易以执行页为准"
    if rates["trend"] == "rapid_rise":
        result["limitations"].append("10Y 仍快速上行，继续观察利率压力；不能仅因加息或降息判断股市方向")
    elif rates["trend"] == "falling":
        result["limitations"].append("10Y 回落可能源于衰退或流动性压力，需结合盈利与冲击信息")

    return result


def get_us_market_judgment(refresh=False, *, today=None):
    """Live read-only snapshot. Failures degrade to explicit unknown fields."""
    now = time.time()
    as_of_date = datetime.date.fromisoformat(str(today)) if today is not None else datetime.date.today()
    if not refresh and _CACHE["payload"] and now < _CACHE["expires"] and _CACHE["payload"].get("judged_on") == as_of_date.isoformat():
        return _CACHE["payload"]
    errors = {}
    try:
        treasury = fetch_us_treasury_yield_history()
    except Exception as exc:
        treasury = []
        errors["treasury"] = str(exc)
    try:
        quote_payload = get_etf_quotes([symbol for group in INDEX_ETFS.values() for symbol in group])
        quotes = quote_payload.get("quotes") or []
        if quote_payload.get("error"):
            errors["etf_quotes"] = quote_payload["error"]
        premium_by_symbol = {row["symbol"]: (row.get("product_quality") or {}).get("premium_discount_pct") for row in quotes}
    except Exception as exc:
        premium_by_symbol = {}
        errors["etf_quotes"] = str(exc)
    items = {}
    for code, spec in INDEXES.items():
        try:
            rows, provider = fetch_index_history(code, start_date="20240101", preferred_source="tencent", market_symbol=spec["market_symbol"])
            item = judge_index(code, rows, treasury, premium_pct=premium_by_symbol.get(spec["symbol"]), today=as_of_date)
            item["evidence"]["index_provider"] = provider
        except Exception as exc:
            errors[code] = str(exc)
            item = judge_index(code, [], treasury, premium_pct=premium_by_symbol.get(spec["symbol"]), today=as_of_date)
        item["execution_by_symbol"] = {
            symbol: _premium_execution(premium_by_symbol.get(symbol))
            for symbol in INDEX_ETFS[code]
        }
        items[code] = item
    payload = {"judged_on": as_of_date.isoformat(), "items": items, "errors": errors, "degraded": bool(errors) or any(v["market_state"] == "insufficient_data" or any(e["etf_buy_status"] == "blocked_missing_premium" for e in v["execution_by_symbol"].values()) for v in items.values()),
               "status": "advisory_only", "observations_required": ["Fed 政策与预期", "盈利预期", "经济/流动性或政策冲击的独立证据"]}
    _CACHE.update(payload=payload, expires=now + (300 if payload["degraded"] else 1800))
    return payload

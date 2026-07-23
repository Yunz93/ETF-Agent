#!/usr/bin/env python3
"""Market timezone, session, and freshness helpers."""

import time
from datetime import datetime, time as datetime_time
from zoneinfo import ZoneInfo

def market_timezone(market):
    return ZoneInfo(
        {
            "A": "Asia/Shanghai",
            "HK": "Asia/Hong_Kong",
            "US": "America/New_York",
        }.get(market, "Asia/Shanghai")
    )


def parse_market_timestamp(value, market):
    if not value:
        return None
    digits = "".join(character for character in value if character.isdigit())
    for length, pattern in ((14, "%Y%m%d%H%M%S"), (12, "%Y%m%d%H%M")):
        if len(digits) >= length:
            try:
                local_time = datetime.strptime(digits[:length], pattern).replace(
                    tzinfo=market_timezone(market)
                )
                return int(local_time.timestamp())
            except ValueError:
                pass
    return None


def format_market_time(timestamp, market):
    if not timestamp:
        return None
    labels = {"A": "CST", "HK": "HKT", "US": "ET"}
    value = datetime.fromtimestamp(timestamp, market_timezone(market))
    return f"{value:%Y-%m-%d %H:%M} {labels.get(market, '')}".strip()


def market_session_windows(market):
    """Regular continuous trading windows in the exchange local timezone."""
    if market == "A":
        # Ignore lunch break 11:30–13:00 so mid-day quotes are not marked stale.
        return ((datetime_time(9, 30), datetime_time(11, 30)), (datetime_time(13, 0), datetime_time(15, 0)))
    if market == "HK":
        return ((datetime_time(9, 30), datetime_time(12, 0)), (datetime_time(13, 0), datetime_time(16, 0)))
    return ((datetime_time(9, 30), datetime_time(16, 0)),)


def in_market_session(market, local_now):
    if local_now.weekday() >= 5:
        return False
    clock = local_now.time()
    return any(start <= clock <= end for start, end in market_session_windows(market))


def market_freshness(market, timestamp, now=None, max_age=1800):
    if not timestamp:
        return {"fresh": False, "status": "missing", "delay_seconds": None, "in_session": False}
    now = now or time.time()
    age = max(0, int(now - timestamp))
    local_now = datetime.fromtimestamp(now, market_timezone(market))
    in_session = in_market_session(market, local_now)
    # Free quote feeds are delayed (especially HK/US). Treat ≤15m as live in-session;
    # configured max_age still gates overall freshness policy elsewhere.
    live_max_age = min(int(max_age), 900)
    if in_session:
        return {
            "fresh": age <= live_max_age,
            "status": "live" if age <= live_max_age else "stale",
            "delay_seconds": age,
            "in_session": True,
        }
    recent_close = age <= 72 * 3600
    return {
        "fresh": recent_close,
        "status": "recent_close" if recent_close else "stale",
        "delay_seconds": age,
        "in_session": False,
    }

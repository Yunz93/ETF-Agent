#!/usr/bin/env python3
"""Gold macro overlay service: US 10Y + USD index → soft DCA multiplier."""

from __future__ import annotations

import time

from .dividend_sources import fetch_us_treasury_yield_history, fetch_usd_index_history
from .gold_macro_math import build_gold_macro_snapshot
from .symbols import as_of

GOLD_MACRO_CACHE = {"payload": None, "expires": 0.0}
GOLD_MACRO_TTL_SECONDS = 30 * 60


def clear_gold_macro_cache():
    GOLD_MACRO_CACHE["payload"] = None
    GOLD_MACRO_CACHE["expires"] = 0.0


def _degraded_payload(reason):
    return {
        "as_of": as_of(None),
        "score": None,
        "mult": 1.0,
        "zone": "unknown",
        "band": "宏观暂缺",
        "hint": reason or "美债/美元数据不足，宏观层按中性",
        "degraded": True,
        "us10y": {
            "value": None,
            "date": None,
            "change_60d_bp": None,
            "level_score": None,
            "trend_score": None,
        },
        "usd_index": {
            "value": None,
            "bias_ma120_pct": None,
            "score": None,
            "samples": 0,
        },
        "components": [],
        "errors": {"macro": reason} if reason else {},
        "provider": "东方财富",
        "source_url": "https://data.eastmoney.com/cjsj/zmgzsyl.html",
    }


def get_gold_macro(refresh=False):
    """Return cached gold-friendly macro snapshot for commodity DCA overlay."""
    now = time.time()
    cached = GOLD_MACRO_CACHE.get("payload")
    if not refresh and cached is not None and now < float(GOLD_MACRO_CACHE.get("expires") or 0):
        return cached

    errors = {}
    us_rows = []
    usd_rows = []
    try:
        us_rows = fetch_us_treasury_yield_history()
    except Exception as exc:
        errors["us10y"] = str(exc)
    try:
        usd_rows = fetch_usd_index_history()
    except Exception as exc:
        errors["usd_index"] = str(exc)

    if not us_rows and not usd_rows:
        payload = _degraded_payload("美债与美元指数均不可用")
        payload["errors"] = errors
        GOLD_MACRO_CACHE["payload"] = payload
        GOLD_MACRO_CACHE["expires"] = now + 5 * 60
        return payload

    closes = [row["close"] for row in usd_rows]
    payload = build_gold_macro_snapshot(
        us_rows,
        closes,
        as_of=as_of(None),
        provider="东方财富",
        source_url="https://data.eastmoney.com/cjsj/zmgzsyl.html",
    )
    if errors:
        payload["errors"] = errors
        # 单腿缺失时仍可用另一腿；两侧都缺才算完全降级（上面已处理）。
        if payload.get("score") is None:
            payload["degraded"] = True
    GOLD_MACRO_CACHE["payload"] = payload
    GOLD_MACRO_CACHE["expires"] = now + GOLD_MACRO_TTL_SECONDS
    return payload

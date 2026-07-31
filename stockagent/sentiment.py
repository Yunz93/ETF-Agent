#!/usr/bin/env python3
"""Market sentiment snapshots from real wide-index ETF price history.

Anchors (A-share listed ETFs, fetched via existing quote history stack):
  A  → 563360 中证A500
  US → 513390 纳斯达克100
  HK → 513010 恒生科技
"""

from __future__ import annotations

import time

from .quotes import get_price_history
from .sentiment_math import (
    DEFAULT_SENTIMENT_BANDS,
    build_sentiment_snapshot,
    closes_from_points,
    multiplier_from_sentiment_bands,
)
from .state import SENTIMENT_CACHE
from .symbols import as_of

# A-listed ETF proxies so get_price_history(..., market="A") works.
SENTIMENT_ANCHORS = {
    "A": {
        "symbol": "563360",
        "name": "A500ETF华泰柏瑞",
        "index_name": "中证A500",
    },
    "US": {
        "symbol": "513390",
        "name": "纳指100ETF博时",
        "index_name": "纳斯达克100",
    },
    "HK": {
        "symbol": "513010",
        "name": "恒生科技ETF易方达",
        "index_name": "恒生科技",
    },
}

CACHE_SECONDS = 1800
HISTORY_RANGE = "5y"
SMOOTH_DAYS = 10


def _parse_markets(markets):
    if markets is None:
        return ["A", "HK", "US"]
    if isinstance(markets, str):
        parts = [part.strip().upper() for part in markets.replace("，", ",").split(",")]
    else:
        parts = [str(part).strip().upper() for part in markets]
    allowed = []
    for part in parts:
        if part in SENTIMENT_ANCHORS and part not in allowed:
            allowed.append(part)
    return allowed or ["A", "HK", "US"]


def _degraded_snapshot(market, reason, anchor=None):
    anchor = anchor or SENTIMENT_ANCHORS.get(market) or {}
    mapping = multiplier_from_sentiment_bands(None)
    return {
        "market": market,
        "anchor_symbol": anchor.get("symbol"),
        "anchor_name": anchor.get("name"),
        "index_name": anchor.get("index_name"),
        "as_of": None,
        "score": None,
        "score_latest": None,
        "smooth_days": SMOOTH_DAYS,
        "smooth_samples": 0,
        "zone": "unknown",
        "mult": 1.0,
        "band": mapping["band"],
        "hint": mapping["hint"],
        "extremes_only": True,
        "components": [],
        "degraded": True,
        "error": reason,
        "provider": None,
        "source_url": None,
        "point_count": 0,
    }


def _snapshot_for_market(market, refresh=False):
    anchor = SENTIMENT_ANCHORS[market]
    symbol = anchor["symbol"]
    cache_key = f"sentiment:{market}:{symbol}:{HISTORY_RANGE}"
    now = time.time()
    if not refresh:
        cached = SENTIMENT_CACHE.get(cache_key)
        if cached and cached["expires"] > now:
            return cached["payload"]

    history = get_price_history(symbol, "A", HISTORY_RANGE)
    if history.get("error") and not history.get("points"):
        payload = _degraded_snapshot(market, history.get("error") or "历史行情不可用", anchor)
        SENTIMENT_CACHE[cache_key] = {"expires": now + 120, "payload": payload}
        return payload

    closes = closes_from_points(history.get("points") or [])
    if len(closes) < 60:
        payload = _degraded_snapshot(
            market,
            f"历史样本不足（{len(closes)} 点，至少需要 60）",
            anchor,
        )
        SENTIMENT_CACHE[cache_key] = {"expires": now + 120, "payload": payload}
        return payload

    as_of_date = None
    points = history.get("points") or []
    if points:
        as_of_date = points[-1].get("date")

    snapshot = build_sentiment_snapshot(
        closes,
        market=market,
        anchor_symbol=symbol,
        provider=history.get("provider"),
        source_url=history.get("source_url"),
        as_of=as_of_date,
        smooth_days=SMOOTH_DAYS,
        extremes_only=True,
        bands=DEFAULT_SENTIMENT_BANDS,
    )
    snapshot["anchor_name"] = anchor["name"]
    snapshot["index_name"] = anchor["index_name"]
    if history.get("warning"):
        snapshot["warning"] = history["warning"]
    SENTIMENT_CACHE[cache_key] = {"expires": now + CACHE_SECONDS, "payload": snapshot}
    return snapshot


def get_market_sentiment(markets=None, refresh=False):
    """Return sentiment snapshots for requested markets."""
    selected = _parse_markets(markets)
    items = {}
    errors = []
    for market in selected:
        try:
            items[market] = _snapshot_for_market(market, refresh=refresh)
        except Exception as exc:  # pragma: no cover - defensive
            items[market] = _degraded_snapshot(market, str(exc))
            errors.append(f"{market}: {exc}")

    degraded = any(item.get("degraded") for item in items.values()) or bool(errors)
    return {
        "items": items,
        "anchors": {
            key: {
                "symbol": value["symbol"],
                "name": value["name"],
                "index_name": value["index_name"],
            }
            for key, value in SENTIMENT_ANCHORS.items()
            if key in selected
        },
        "updated_at": as_of(None),
        "cache_seconds": CACHE_SECONDS,
        "history_range": HISTORY_RANGE,
        "smooth_days": SMOOTH_DAYS,
        "degraded": degraded,
        "error": "；".join(errors) if errors else None,
        "note": "宽基 ETF 真实收盘价衍生：波动体制 + 回撤深度；仅极端区调节定投倍率",
    }


def probe_sentiment_sources():
    """Lightweight health probe: ensure each anchor history returns points."""
    results = {}
    for market, anchor in SENTIMENT_ANCHORS.items():
        symbol = anchor["symbol"]
        try:
            # Prefer cache / 1y for speed; still real network on cold start.
            history = get_price_history(symbol, "A", "1y")
            points = history.get("points") or []
            ok = len(points) >= 60 and not (history.get("error") and not points)
            results[market] = {
                "ok": ok,
                "symbol": symbol,
                "points": len(points),
                "provider": history.get("provider"),
                "error": None if ok else (history.get("error") or "样本不足"),
            }
        except Exception as exc:
            results[market] = {
                "ok": False,
                "symbol": symbol,
                "points": 0,
                "provider": None,
                "error": str(exc),
            }
    return results

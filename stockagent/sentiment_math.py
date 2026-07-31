#!/usr/bin/env python3
"""Pure market-sentiment math (no network).

Score convention: 0–100, higher = more greed / euphoria, lower = more fear / panic.
Built from realized volatility regime + drawdown depth only (Phase 1).
"""

from __future__ import annotations

import math
import statistics

from .indicators import percentile_rank


DEFAULT_SENTIMENT_BANDS = (
    {"max_score": 20, "mult": 1.30, "label": "极端恐慌"},
    {"max_score": 40, "mult": 1.15, "label": "偏恐慌"},
    {"max_score": 60, "mult": 1.00, "label": "中性"},
    {"max_score": 80, "mult": 0.75, "label": "偏热"},
    {"max_score": 100, "mult": 0.40, "label": "极端狂热"},
)

ZONE_BANDS = (
    (20, "panic"),
    (40, "fear"),
    (60, "neutral"),
    (80, "greed"),
    (100, "euphoria"),
)

ZONE_HINTS = {
    "panic": "极端恐慌，定投可加码",
    "fear": "偏恐慌，定投可小幅加码",
    "neutral": "情绪中性，不调节倍率",
    "greed": "偏热，定投宜减码",
    "euphoria": "极端狂热，定投明显减码",
    "unknown": "情绪数据不可用，按中性",
}

COMPONENT_WEIGHTS = {
    "vol_regime": 0.55,
    "drawdown": 0.45,
}


def clamp(value, low=0.0, high=100.0):
    return max(low, min(high, value))


def closes_from_points(points):
    closes = []
    for row in points or []:
        try:
            close = float(row.get("close"))
        except (TypeError, ValueError, AttributeError):
            continue
        if math.isfinite(close) and close > 0:
            closes.append(close)
    return closes


def daily_returns(closes):
    returns = []
    for previous, current in zip(closes, closes[1:]):
        if previous > 0:
            returns.append(current / previous - 1.0)
    return returns


def realized_vol(closes, window=20):
    """Annualized realized volatility of the trailing `window` daily returns."""
    if window <= 1 or len(closes) < window + 1:
        return None
    sample = daily_returns(closes[-(window + 1) :])
    if len(sample) < window:
        return None
    if len(sample) < 2:
        return 0.0
    return statistics.stdev(sample) * math.sqrt(252)


def rolling_realized_vol(closes, window=20):
    """Vol series aligned with closes; leading entries are None."""
    result = [None] * len(closes)
    for index in range(len(closes)):
        result[index] = realized_vol(closes[: index + 1], window=window)
    return result


def drawdown_pct(closes, lookback=250):
    """Latest close vs trailing lookback peak, in percent (≤ 0 when below peak)."""
    if not closes or lookback <= 0:
        return None
    tail = closes[-lookback:] if len(closes) >= lookback else closes
    peak = max(tail)
    if peak <= 0:
        return None
    return (closes[-1] / peak - 1.0) * 100.0


def score_vol_regime(closes, window=20, min_samples=60):
    """High trailing vol percentile → lower score (more fear)."""
    series = [value for value in rolling_realized_vol(closes, window=window) if value is not None]
    if len(series) < min_samples:
        current = realized_vol(closes, window=window)
        if current is None:
            return None, {"vol": None, "percentile": None}
        # Fallback absolute map when history is short.
        score = clamp(85 - current * 220)
        return score, {"vol": round(current, 6), "percentile": None, "mode": "absolute"}
    current = series[-1]
    rank = percentile_rank(series, current)
    score = clamp(100.0 - 100.0 * rank)
    return score, {"vol": round(current, 6), "percentile": round(rank, 4), "mode": "percentile"}


def score_drawdown(closes, lookback=250):
    """Deeper drawdown → lower score. Absolute anchors (not RSI)."""
    dd = drawdown_pct(closes, lookback=lookback)
    if dd is None:
        return None, {"drawdown_pct": None}
    anchors = (
        (0.0, 72.0),
        (-3.0, 60.0),
        (-8.0, 45.0),
        (-15.0, 30.0),
        (-25.0, 16.0),
        (-40.0, 6.0),
        (-60.0, 1.0),
    )
    if dd >= anchors[0][0]:
        score = anchors[0][1]
    elif dd <= anchors[-1][0]:
        score = anchors[-1][1]
    else:
        score = anchors[-1][1]
        for (x0, y0), (x1, y1) in zip(anchors, anchors[1:]):
            if dd >= x1:
                score = y0 + (dd - x0) / (x1 - x0) * (y1 - y0)
                break
    return clamp(score), {"drawdown_pct": round(dd, 3)}


def combine_sentiment_components(components, weights=None):
    weights = weights or COMPONENT_WEIGHTS
    total = 0.0
    weight_sum = 0.0
    for key, weight in weights.items():
        value = components.get(key)
        if value is None:
            continue
        total += value * weight
        weight_sum += weight
    if weight_sum <= 0:
        return None
    return round(total / weight_sum, 1)


def zone_for_score(score):
    if score is None:
        return "unknown"
    for threshold, zone in ZONE_BANDS:
        if score <= threshold:
            return zone
    return "euphoria"


def multiplier_from_sentiment_bands(score, bands=None, extremes_only=True, extreme_low=25, extreme_high=75):
    """Map sentiment score → overlay multiplier.

    When extremes_only is True, scores inside (extreme_low, extreme_high) force mult=1.
    """
    if score is None or not math.isfinite(float(score)):
        return {
            "mult": 1.0,
            "zone": "unknown",
            "band": "数据不足",
            "hint": ZONE_HINTS["unknown"],
        }
    score = float(score)
    zone = zone_for_score(score)
    if extremes_only and extreme_low < score < extreme_high:
        return {
            "mult": 1.0,
            "zone": zone,
            "band": "中性死区",
            "hint": "非极端情绪，不调节倍率",
            "score": score,
        }

    active_bands = list(bands or DEFAULT_SENTIMENT_BANDS)
    active_bands.sort(key=lambda item: item["max_score"])
    chosen = active_bands[-1]
    for band in active_bands:
        if score <= band["max_score"]:
            chosen = band
            break
    return {
        "mult": float(chosen["mult"]),
        "zone": zone,
        "band": chosen.get("label") or zone,
        "hint": ZONE_HINTS.get(zone, ZONE_HINTS["neutral"]),
        "score": score,
    }


def sentiment_score_at(closes, end_index, vol_window=20, drawdown_lookback=250):
    """Score using only closes[:end_index+1] (no future peek)."""
    if end_index < 0 or end_index >= len(closes):
        return None, {}
    window = closes[: end_index + 1]
    vol_score, vol_raw = score_vol_regime(window, window=vol_window)
    dd_score, dd_raw = score_drawdown(window, lookback=drawdown_lookback)
    components = {"vol_regime": vol_score, "drawdown": dd_score}
    total = combine_sentiment_components(components)
    return total, {
        "components": components,
        "raw": {"vol_regime": vol_raw, "drawdown": dd_raw},
    }


def smoothed_sentiment_score(closes, smooth_days=10, vol_window=20, drawdown_lookback=250):
    """Average of the last `smooth_days` point-in-time scores."""
    if not closes:
        return None, {"samples": 0, "series": []}
    series = []
    start = max(0, len(closes) - max(1, int(smooth_days)))
    for index in range(start, len(closes)):
        score, _meta = sentiment_score_at(
            closes,
            index,
            vol_window=vol_window,
            drawdown_lookback=drawdown_lookback,
        )
        if score is not None:
            series.append(score)
    if not series:
        return None, {"samples": 0, "series": []}
    return round(sum(series) / len(series), 1), {"samples": len(series), "series": series}


def build_sentiment_snapshot(
    closes,
    *,
    market,
    anchor_symbol,
    provider=None,
    source_url=None,
    as_of=None,
    smooth_days=10,
    extremes_only=True,
    bands=None,
):
    """Assemble one market sentiment snapshot from close prices."""
    latest_score, latest_meta = sentiment_score_at(closes, len(closes) - 1) if closes else (None, {})
    smooth_score, smooth_meta = smoothed_sentiment_score(closes, smooth_days=smooth_days)
    score = smooth_score if smooth_score is not None else latest_score
    mapping = multiplier_from_sentiment_bands(
        score,
        bands=bands,
        extremes_only=extremes_only,
    )
    degraded = score is None
    components = []
    raw_components = (latest_meta or {}).get("components") or {}
    raw_detail = (latest_meta or {}).get("raw") or {}
    for key, weight in COMPONENT_WEIGHTS.items():
        value = raw_components.get(key)
        components.append(
            {
                "id": key,
                "label": "波动体制" if key == "vol_regime" else "回撤深度",
                "score": round(value, 1) if value is not None else None,
                "weight": weight,
                "raw": raw_detail.get(key) or {},
            }
        )
    return {
        "market": market,
        "anchor_symbol": anchor_symbol,
        "as_of": as_of,
        "score": score,
        "score_latest": latest_score,
        "smooth_days": smooth_days,
        "smooth_samples": smooth_meta.get("samples", 0),
        "zone": mapping["zone"],
        "mult": mapping["mult"],
        "band": mapping["band"],
        "hint": mapping["hint"],
        "extremes_only": extremes_only,
        "components": components,
        "degraded": degraded,
        "provider": provider,
        "source_url": source_url,
        "point_count": len(closes),
    }

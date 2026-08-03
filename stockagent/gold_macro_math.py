#!/usr/bin/env python3
"""Pure math for gold macro overlay: US 10Y rates + USD index."""

from __future__ import annotations

# 利率水平锚点：美债越低对黄金越友好（score 越高）。
_US10Y_LEVEL_ANCHORS = (
    (2.0, 95.0),
    (3.0, 80.0),
    (4.0, 55.0),
    (4.5, 40.0),
    (5.0, 25.0),
    (5.5, 12.0),
    (6.5, 5.0),
)

# 美元指数相对年线乖离：越弱（负乖离）对黄金越友好。
_USD_BIAS_ANCHORS = (
    (-8.0, 92.0),
    (-4.0, 78.0),
    (-1.0, 62.0),
    (0.0, 50.0),
    (2.0, 35.0),
    (5.0, 18.0),
    (9.0, 8.0),
)

DEFAULT_GOLD_MACRO_BANDS = (
    {"max_score": 30, "mult": 0.7, "label": "宏观逆风", "zone": "headwind"},
    {"max_score": 45, "mult": 0.85, "label": "略偏逆风", "zone": "mild_headwind"},
    {"max_score": 55, "mult": 1.0, "label": "宏观中性", "zone": "neutral"},
    {"max_score": 70, "mult": 1.1, "label": "略偏友好", "zone": "mild_support"},
    {"max_score": 100, "mult": 1.2, "label": "宏观友好", "zone": "supportive"},
)

COMPONENT_WEIGHTS = {
    "us10y": 0.6,
    "usd_index": 0.4,
}


def _interp(anchors, value):
    if value is None:
        return None
    try:
        x = float(value)
    except (TypeError, ValueError):
        return None
    if x <= anchors[0][0]:
        return anchors[0][1]
    for (x0, y0), (x1, y1) in zip(anchors, anchors[1:]):
        if x <= x1:
            if x1 == x0:
                return y1
            return y0 + (x - x0) / (x1 - x0) * (y1 - y0)
    return anchors[-1][1]


def score_us10y_level(yield_pct):
    """Map US 10Y yield level to gold-friendly score (0-100)."""
    score = _interp(_US10Y_LEVEL_ANCHORS, yield_pct)
    return round(score, 1) if score is not None else None


def score_us10y_trend(change_60d_bp):
    """Falling yields help gold. change in basis points over ~60 trading days."""
    if change_60d_bp is None:
        return None
    try:
        bp = float(change_60d_bp)
    except (TypeError, ValueError):
        return None
    # -100bp → 90, 0 → 50, +100bp → 10
    score = 50.0 - bp * 0.4
    return round(max(5.0, min(95.0, score)), 1)


def score_usd_bias(bias_pct):
    """USD index bias vs MA120 → gold-friendly score."""
    score = _interp(_USD_BIAS_ANCHORS, bias_pct)
    return round(score, 1) if score is not None else None


def sma(values, window):
    if not values or window <= 0 or len(values) < window:
        return None
    chunk = values[-window:]
    return sum(chunk) / len(chunk)


def usd_bias_pct(closes, window=120):
    if not closes:
        return None
    mean = sma(closes, window)
    last = closes[-1]
    if mean is None or not mean:
        return None
    try:
        return (float(last) / float(mean) - 1.0) * 100.0
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def change_bp(series, lookback=60):
    """Basis-point change of a yield series over lookback observations."""
    if not series or len(series) <= lookback:
        return None
    try:
        latest = float(series[-1])
        past = float(series[-1 - lookback])
    except (TypeError, ValueError):
        return None
    return round((latest - past) * 100.0, 1)


def combine_gold_macro_score(rate_level_score, rate_trend_score, dollar_score):
    """Weighted gold-friendly score. Missing legs renormalize."""
    rate_parts = []
    if rate_level_score is not None:
        rate_parts.append((rate_level_score, 0.7))
    if rate_trend_score is not None:
        rate_parts.append((rate_trend_score, 0.3))
    rate_score = None
    if rate_parts:
        weight = sum(w for _, w in rate_parts)
        rate_score = sum(v * w for v, w in rate_parts) / weight

    parts = []
    if rate_score is not None:
        parts.append((rate_score, COMPONENT_WEIGHTS["us10y"]))
    if dollar_score is not None:
        parts.append((dollar_score, COMPONENT_WEIGHTS["usd_index"]))
    if not parts:
        return None, {"us10y": rate_score, "usd_index": dollar_score}
    weight = sum(w for _, w in parts)
    total = sum(v * w for v, w in parts) / weight
    return round(total, 1), {"us10y": rate_score, "usd_index": dollar_score}


def multiplier_from_gold_macro_score(score, bands=None):
    active = bands or DEFAULT_GOLD_MACRO_BANDS
    if score is None:
        return {
            "mult": 1.0,
            "zone": "unknown",
            "band": "宏观暂缺",
            "hint": "美债/美元数据不足，宏观层按中性",
        }
    try:
        value = float(score)
    except (TypeError, ValueError):
        return {
            "mult": 1.0,
            "zone": "unknown",
            "band": "宏观暂缺",
            "hint": "美债/美元数据不足，宏观层按中性",
        }
    for band in active:
        if value <= float(band["max_score"]):
            zone = band.get("zone") or "neutral"
            label = band.get("label") or "宏观"
            mult = float(band.get("mult", 1.0))
            if mult > 1:
                hint = "实际利率/美元偏友好，宏观层略加黄金仓位节奏"
            elif mult < 1:
                hint = "美债利率或美元偏强，宏观层放缓黄金加仓"
            else:
                hint = "宏观中性，黄金节奏交给技术面"
            return {"mult": mult, "zone": zone, "band": label, "hint": hint}
    last = active[-1]
    return {
        "mult": float(last.get("mult", 1.0)),
        "zone": last.get("zone") or "supportive",
        "band": last.get("label") or "宏观友好",
        "hint": "宏观偏友好，略加黄金仓位节奏",
    }


def build_gold_macro_snapshot(us10y_rows, usd_closes, *, as_of=None, provider=None, source_url=None):
    """Build overlay snapshot from US10Y history rows and USD index closes."""
    yields = []
    latest_yield = None
    latest_yield_date = None
    for row in us10y_rows or []:
        try:
            value = float(row.get("us10y"))
        except (TypeError, ValueError, AttributeError):
            continue
        yields.append(value)
        latest_yield = value
        latest_yield_date = row.get("date")

    closes = []
    for value in usd_closes or []:
        try:
            closes.append(float(value))
        except (TypeError, ValueError):
            continue

    level_score = score_us10y_level(latest_yield)
    trend_score = score_us10y_trend(change_bp(yields, 60))
    bias = usd_bias_pct(closes, 120)
    dollar_score = score_usd_bias(bias)
    score, components = combine_gold_macro_score(level_score, trend_score, dollar_score)
    mapping = multiplier_from_gold_macro_score(score)
    degraded = score is None
    return {
        "as_of": as_of or latest_yield_date,
        "score": score,
        "mult": mapping["mult"],
        "zone": mapping["zone"],
        "band": mapping["band"],
        "hint": mapping["hint"],
        "degraded": degraded,
        "us10y": {
            "value": round(latest_yield, 3) if latest_yield is not None else None,
            "date": latest_yield_date,
            "change_60d_bp": change_bp(yields, 60),
            "level_score": level_score,
            "trend_score": trend_score,
        },
        "usd_index": {
            "value": round(closes[-1], 3) if closes else None,
            "bias_ma120_pct": round(bias, 2) if bias is not None else None,
            "score": dollar_score,
            "samples": len(closes),
        },
        "components": [
            {
                "id": "us10y",
                "label": "美债利率",
                "score": components.get("us10y"),
                "weight": COMPONENT_WEIGHTS["us10y"],
            },
            {
                "id": "usd_index",
                "label": "美元指数",
                "score": components.get("usd_index"),
                "weight": COMPONENT_WEIGHTS["usd_index"],
            },
        ],
        "provider": provider,
        "source_url": source_url,
    }

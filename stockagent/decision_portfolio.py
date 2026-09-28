"""Index-sleeve decision portfolio: no ledger, no cash, no trade history.

The unit of allocation is a tracked index (sleeve). Each sleeve lists exchange ETFs
and OTC funds that follow that index. Tracking quality lives on the instrument.
"""

from copy import deepcopy

from .dividend_registry import analysis_registry, resolve_analysis_settings

DEFAULT_SLEEVE_SPECS = (
    ("sp500", "标普500", "SPX", 45, (("513500", "标普500ETF博时", "exchange"),)),
    ("nasdaq", "纳斯达克100", "NDX", 25, (("513390", "纳指100ETF博时", "exchange"),)),
    ("gold", "黄金", "GOLD", 15, (("159937", "黄金ETF博时", "exchange"),)),
    ("dividend", "红利低波", "H30269", 15, (("512890", "红利低波ETF华泰柏瑞", "exchange"),)),
)

PORTFOLIO_CATEGORY_INDEX = {
    "sp500": ("SPX", "标普500"),
    "nasdaq": ("NDX", "纳斯达克100"),
    "gold": ("GOLD", "黄金"),
    "dividend": ("H30269", "红利低波"),
}

INDEX_PRESETS = (
    {"id": "sp500", "name": "标普500", "index_code": "SPX", "primary_symbol": "513500"},
    {"id": "nasdaq", "name": "纳斯达克100", "index_code": "NDX", "primary_symbol": "513390"},
    {"id": "dividend", "name": "红利低波", "index_code": "H30269", "primary_symbol": "512890"},
    {"id": "gold", "name": "黄金", "index_code": "GOLD", "primary_symbol": "159937"},
    {"id": "hstech", "name": "恒生科技", "index_code": "HSTECH", "primary_symbol": "513010"},
    {"id": "a500", "name": "中证A500", "index_code": "000510", "primary_symbol": "563360"},
    {"id": "csi300", "name": "沪深300", "index_code": "000300", "primary_symbol": "510300"},
)


def _symbol(raw):
    digits = "".join(ch for ch in str(raw or "") if ch.isdigit())
    if not digits or len(digits) > 6:
        return ""
    return digits.zfill(6)


def _clamp_pct(value, fallback=0):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    if number < 0:
        return 0.0
    if number > 100:
        return 100.0
    return round(number, 2)


def _instrument_id(symbol, kind):
    return f"{kind}_{symbol}"


def normalize_instrument(item, *, fallback_index=""):
    if not isinstance(item, dict):
        return None
    symbol = _symbol(item.get("symbol"))
    if not symbol:
        return None
    kind = str(item.get("kind") or "exchange").strip().lower()
    if kind not in ("exchange", "fund"):
        kind = "exchange"
    name = str(item.get("name") or "").strip()
    if not name:
        settings = resolve_analysis_settings(symbol)
        name = str(settings.get("etf_name") or symbol)
    role = str(item.get("role") or "").strip().lower()
    if role not in ("primary", "alternate"):
        role = "alternate"
    note = str(item.get("note") or "").strip()[:80]
    ident = str(item.get("id") or "").strip() or _instrument_id(symbol, kind)
    return {
        "id": ident[:80],
        "symbol": symbol,
        "name": name[:40],
        "kind": kind,
        "role": role,
        "note": note,
        "index_code": str(item.get("index_code") or fallback_index or "").strip().upper(),
    }


def normalize_sleeve(item):
    if not isinstance(item, dict):
        return None
    sleeve_id = str(item.get("id") or "").strip()
    name = str(item.get("name") or "").strip()
    index_code = str(item.get("index_code") or "").strip().upper()
    if not sleeve_id or not name or not index_code:
        return None
    instruments = []
    seen = set()
    for raw in item.get("instruments") or []:
        row = normalize_instrument(raw, fallback_index=index_code)
        if not row or row["id"] in seen:
            continue
        seen.add(row["id"])
        instruments.append(row)
    if not instruments:
        return None
    if not any(row["role"] == "primary" for row in instruments):
        instruments[0]["role"] = "primary"
    else:
        primary_seen = False
        for row in instruments:
            if row["role"] == "primary":
                if primary_seen:
                    row["role"] = "alternate"
                else:
                    primary_seen = True
    return {
        "id": sleeve_id[:40],
        "name": name[:40],
        "index_code": index_code[:16],
        "target_pct": _clamp_pct(item.get("target_pct"), 0),
        "note": str(item.get("note") or "").strip()[:80],
        "instruments": instruments,
    }


def default_decision():
    sleeves = []
    for sleeve_id, name, index_code, pct, products in DEFAULT_SLEEVE_SPECS:
        instruments = []
        for i, (symbol, product_name, kind) in enumerate(products):
            instruments.append(
                {
                    "id": _instrument_id(symbol, kind),
                    "symbol": symbol,
                    "name": product_name,
                    "kind": kind,
                    "role": "primary" if i == 0 else "alternate",
                    "note": "",
                    "index_code": index_code,
                }
            )
        sleeves.append(
            {
                "id": sleeve_id,
                "name": name,
                "index_code": index_code,
                "target_pct": pct,
                "note": "",
                "instruments": instruments,
            }
        )
    return {"name": "核心指数组合", "note": "", "sleeves": sleeves}


def decision_from_portfolio(portfolio):
    if not isinstance(portfolio, dict):
        return None
    categories = portfolio.get("categories") or []
    products = portfolio.get("products") or []
    if not categories:
        return None
    sleeves = []
    for category in categories:
        if not isinstance(category, dict):
            continue
        cid = str(category.get("id") or "").strip()
        name = str(category.get("name") or "").strip()
        if not cid or not name:
            continue
        mapped = PORTFOLIO_CATEGORY_INDEX.get(cid)
        index_code = mapped[0] if mapped else cid.upper()
        display = mapped[1] if mapped else name
        primary_id = category.get("primary_product_id")
        owned = [p for p in products if isinstance(p, dict) and p.get("category_id") == cid]
        instruments = []
        for product in owned:
            kind = "fund" if product.get("kind") == "fund" else "exchange"
            symbol = _symbol(product.get("symbol"))
            if not symbol:
                continue
            instruments.append(
                {
                    "id": str(product.get("id") or _instrument_id(symbol, kind)),
                    "symbol": symbol,
                    "name": str(product.get("name") or symbol),
                    "kind": kind,
                    "role": "primary" if product.get("id") == primary_id else "alternate",
                    "note": "",
                    "index_code": index_code,
                }
            )
        if not instruments:
            continue
        sleeves.append(
            {
                "id": cid,
                "name": display,
                "index_code": index_code,
                "target_pct": _clamp_pct(category.get("target_pct"), 0),
                "note": "",
                "instruments": instruments,
            }
        )
    if not sleeves:
        return None
    return {"name": str(portfolio.get("name") or "核心指数组合"), "note": "由持仓账本迁移为决策组合", "sleeves": sleeves}


def _rescale_targets(sleeves):
    total = sum(row["target_pct"] for row in sleeves)
    if total <= 0:
        share = round(100 / len(sleeves), 2) if sleeves else 0
        for row in sleeves:
            row["target_pct"] = share
        if sleeves:
            sleeves[-1]["target_pct"] = round(100 - share * (len(sleeves) - 1), 2)
        return sleeves
    if abs(total - 100) < 0.05:
        return sleeves
    scaled = []
    running = 0.0
    for index, row in enumerate(sleeves):
        copy = dict(row)
        if index == len(sleeves) - 1:
            copy["target_pct"] = round(100 - running, 2)
        else:
            copy["target_pct"] = round(row["target_pct"] * 100 / total, 2)
            running += copy["target_pct"]
        scaled.append(copy)
    return scaled


def normalize_decision(payload, *, portfolio=None):
    source = payload if isinstance(payload, dict) else None
    if source is None or not source.get("sleeves"):
        migrated = decision_from_portfolio(portfolio)
        source = migrated or default_decision()
    sleeves = []
    seen = set()
    for item in source.get("sleeves") or []:
        sleeve = normalize_sleeve(item)
        if not sleeve or sleeve["id"] in seen:
            continue
        seen.add(sleeve["id"])
        sleeves.append(sleeve)
    if not sleeves:
        return default_decision()
    return {
        "name": str(source.get("name") or "核心指数组合").strip()[:40] or "核心指数组合",
        "note": str(source.get("note") or "").strip()[:120],
        "sleeves": _rescale_targets(sleeves),
    }


def primary_symbol(sleeve):
    if not isinstance(sleeve, dict):
        return ""
    for row in sleeve.get("instruments") or []:
        if row.get("role") == "primary":
            return row.get("symbol") or ""
    instruments = sleeve.get("instruments") or []
    return instruments[0]["symbol"] if instruments else ""


def index_instrument_catalog():
    """Known exchange ETFs grouped by index_code, plus the gold proxy."""
    groups = {}
    for symbol, entry in analysis_registry().items():
        code = str(entry.get("index_code") or "").strip().upper()
        if not code:
            continue
        groups.setdefault(code, {"index_code": code, "index_name": entry.get("index_name") or code, "instruments": []})
        groups[code]["instruments"].append(
            {
                "symbol": symbol,
                "name": entry.get("etf_name") or symbol,
                "kind": "exchange",
            }
        )
    groups.setdefault(
        "GOLD",
        {"index_code": "GOLD", "index_name": "黄金", "instruments": []},
    )
    if not any(row["symbol"] == "159937" for row in groups["GOLD"]["instruments"]):
        groups["GOLD"]["instruments"].append(
            {"symbol": "159937", "name": "黄金ETF博时", "kind": "exchange"}
        )
    return {
        "presets": [dict(row) for row in INDEX_PRESETS],
        "indexes": sorted(groups.values(), key=lambda row: row["index_code"]),
    }


def sleeve_by_symbol(decision, symbol):
    wanted = _symbol(symbol)
    if not wanted:
        return None
    for sleeve in (decision or {}).get("sleeves") or []:
        for instrument in sleeve.get("instruments") or []:
            if instrument.get("symbol") == wanted:
                return deepcopy(sleeve)
    return None

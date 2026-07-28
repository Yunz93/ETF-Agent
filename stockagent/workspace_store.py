#!/usr/bin/env python3
"""Workspace persistence and normalization (DCA plan + ETF holdings)."""

import datetime
import json

from .defaults import DEFAULT_TARGET_WEIGHTS, DEFAULT_WORKSPACE
from .paths import WORKSPACE_LOCK, WORKSPACE_PATH
from .symbols import as_of


def empty_workspace():
    return json.loads(json.dumps(DEFAULT_WORKSPACE))


def _positive_number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0
    return number if number > 0 else 0


def _clamp_weight(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0
    if number < 0:
        return 0
    if number > 100:
        return 100
    return round(number, 2)


def normalize_etf_entry(item):
    if not isinstance(item, dict):
        return None
    digits = "".join(ch for ch in str(item.get("symbol") or "") if ch.isdigit())
    symbol = digits.zfill(6)
    if len(symbol) != 6 or not digits:
        return None

    target = item.get("target_weight")
    if target is None and item.get("targetWeight") is not None:
        target = item.get("targetWeight")

    return {
        "symbol": symbol,
        "name": str(item.get("name") or "").strip(),
        "shares": _positive_number(item.get("shares")),
        "cost": _positive_number(item.get("cost")),
        "target_weight": _clamp_weight(target),
        "note": str(item.get("note") or "").strip(),
    }


def normalize_plan(payload):
    base = dict(DEFAULT_WORKSPACE["plan"])
    if not isinstance(payload, dict):
        return base
    name = str(payload.get("name") or base["name"]).strip() or base["name"]
    cadence = str(payload.get("cadence") or base["cadence"]).strip().lower()
    if cadence not in ("weekly", "biweekly", "monthly"):
        cadence = base["cadence"]
    try:
        day = int(payload.get("day", base["day"]))
    except (TypeError, ValueError):
        day = base["day"]
    if cadence == "monthly":
        day = min(28, max(1, day))
    else:
        day = min(7, max(1, day))
    return {
        "name": name,
        "amount": _positive_number(payload.get("amount")) or 0,
        "cadence": cadence,
        "day": day,
        "note": str(payload.get("note") or "").strip(),
    }


def normalize_buy_entry(item):
    if not isinstance(item, dict):
        return None
    digits = "".join(ch for ch in str(item.get("symbol") or "") if ch.isdigit())
    symbol = digits.zfill(6)
    if len(symbol) != 6 or not digits:
        return None
    date = str(item.get("date") or "").strip()
    if len(date) != 10 or date[4] != "-" or date[7] != "-":
        return None
    try:
        year, month, day = (int(part) for part in date.split("-"))
        if not (1990 <= year <= 2100):
            return None
        datetime.date(year, month, day)
    except (TypeError, ValueError):
        return None
    shares = _positive_number(item.get("shares"))
    price = _positive_number(item.get("price"))
    if shares <= 0 or price <= 0:
        return None
    buy_id = str(item.get("id") or "").strip()
    if not buy_id:
        buy_id = f"buy_{symbol}_{date}_{int(shares)}_{int(price * 10000)}"
    return {
        "id": buy_id,
        "symbol": symbol,
        "date": date,
        "price": round(price, 6),
        "shares": round(shares, 4),
        "note": str(item.get("note") or "").strip(),
    }


def normalize_workspace(payload):
    workspace = empty_workspace()
    if not isinstance(payload, dict):
        return workspace

    raw_etfs = payload.get("etfs") or []
    had_any_target = any(
        isinstance(item, dict)
        and (item.get("target_weight") is not None or item.get("targetWeight") is not None)
        for item in raw_etfs
    )

    seen = set()
    etfs = []
    for item in raw_etfs:
        entry = normalize_etf_entry(item)
        if entry and entry["symbol"] not in seen:
            seen.add(entry["symbol"])
            etfs.append(entry)

    # 旧版 workspace 无目标仓位字段时，按种子默认比例补齐
    if etfs and not had_any_target:
        for entry in etfs:
            entry["target_weight"] = float(DEFAULT_TARGET_WEIGHTS.get(entry["symbol"], 0))

    workspace["etfs"] = etfs
    workspace["plan"] = normalize_plan(payload.get("plan"))

    buys = []
    seen_buy_ids = set()
    for item in payload.get("buys") or []:
        entry = normalize_buy_entry(item)
        if not entry or entry["id"] in seen_buy_ids:
            continue
        seen_buy_ids.add(entry["id"])
        buys.append(entry)
    buys.sort(key=lambda row: (row["date"], row["symbol"], row["id"]), reverse=True)
    workspace["buys"] = buys

    if isinstance(payload.get("prefs"), dict):
        workspace["prefs"] = payload["prefs"]

    workspace["version"] = 4
    workspace["updated_at"] = payload.get("updated_at") or as_of(None)
    return workspace


def workspace_has_user_data(workspace):
    if not isinstance(workspace, dict):
        return False
    return bool(workspace.get("etfs") or workspace.get("buys"))


def get_workspace():
    with WORKSPACE_LOCK:
        if not WORKSPACE_PATH.exists():
            return empty_workspace()
        try:
            with WORKSPACE_PATH.open(encoding="utf-8") as handle:
                loaded = json.load(handle)
            return normalize_workspace(loaded)
        except Exception:
            return empty_workspace()


def save_workspace(payload):
    with WORKSPACE_LOCK:
        workspace = normalize_workspace(payload)
        workspace["updated_at"] = as_of(None)
        temp_path = WORKSPACE_PATH.with_suffix(".json.tmp")
        temp_path.write_text(json.dumps(workspace, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temp_path.replace(WORKSPACE_PATH)
        return workspace


def default_target_weight(symbol):
    return float(DEFAULT_TARGET_WEIGHTS.get(symbol, 0))

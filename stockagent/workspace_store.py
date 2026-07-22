#!/usr/bin/env python3
"""Workspace persistence and normalization (ETF pool + prefs)."""

import json

from .defaults import DEFAULT_WORKSPACE
from .paths import WORKSPACE_LOCK, WORKSPACE_PATH
from .symbols import as_of

def empty_workspace():
    return json.loads(json.dumps(DEFAULT_WORKSPACE))


def normalize_etf_entry(item):
    if not isinstance(item, dict):
        return None
    digits = "".join(ch for ch in str(item.get("symbol") or "") if ch.isdigit())
    symbol = digits.zfill(6)
    if len(symbol) != 6 or not digits:
        return None

    def positive_number(value):
        try:
            number = float(value)
        except (TypeError, ValueError):
            return 0
        return number if number > 0 else 0

    return {
        "symbol": symbol,
        "name": str(item.get("name") or "").strip(),
        "shares": positive_number(item.get("shares")),
        "cost": positive_number(item.get("cost")),
        "note": str(item.get("note") or "").strip(),
    }


def normalize_workspace(payload):
    workspace = empty_workspace()
    if not isinstance(payload, dict):
        return workspace

    seen = set()
    etfs = []
    for item in payload.get("etfs") or []:
        entry = normalize_etf_entry(item)
        if entry and entry["symbol"] not in seen:
            seen.add(entry["symbol"])
            etfs.append(entry)
    workspace["etfs"] = etfs

    if isinstance(payload.get("prefs"), dict):
        workspace["prefs"] = payload["prefs"]

    workspace["version"] = 2
    workspace["updated_at"] = payload.get("updated_at") or as_of(None)
    return workspace


def workspace_has_user_data(workspace):
    if not isinstance(workspace, dict):
        return False
    return bool(workspace.get("etfs"))


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

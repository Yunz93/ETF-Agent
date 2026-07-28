#!/usr/bin/env python3
"""Configuration loading, normalization, and persistence."""

import json

from .defaults import *
from .paths import *
from .state import *

def _set_config(config):
    CONFIG.clear()
    CONFIG.update(config)
    return CONFIG


def load_config():
    global CONFIG
    if CONFIG_PATH.exists():
        with CONFIG_PATH.open(encoding="utf-8") as handle:
            loaded = json.load(handle)
        _set_config(normalize_config(loaded))
    else:
        seed = RESOURCE_ROOT / "config.json"
        if seed.exists() and seed.resolve() != CONFIG_PATH.resolve():
            try:
                loaded = json.loads(seed.read_text(encoding="utf-8"))
                _set_config(normalize_config(loaded))
            except Exception:
                _set_config(json.loads(json.dumps(DEFAULT_CONFIG)))
        else:
            _set_config(json.loads(json.dumps(DEFAULT_CONFIG)))
        save_config(CONFIG)
    return CONFIG


def normalize_config(payload):
    config = json.loads(json.dumps(DEFAULT_CONFIG))
    if isinstance(payload.get("server"), dict):
        config["server"].update(payload["server"])
    if isinstance(payload.get("quotes"), dict):
        config["quotes"].update(payload["quotes"])
    if isinstance(payload.get("dividend"), dict):
        config["dividend"].update(payload["dividend"])
    if isinstance(payload.get("etf"), dict):
        etf = payload["etf"]
        pool = []
        for item in etf.get("pool") or []:
            if not isinstance(item, dict):
                continue
            symbol = "".join(ch for ch in str(item.get("symbol") or "") if ch.isdigit()).zfill(6)
            if len(symbol) != 6 or not symbol.strip("0"):
                continue
            pool.append({"symbol": symbol, "name": str(item.get("name") or "").strip()})
        if pool:
            config["etf"]["pool"] = pool
        if etf.get("note"):
            config["etf"]["note"] = str(etf["note"]).strip()
        analysis = {}
        raw_analysis = etf.get("analysis") or {}
        if isinstance(raw_analysis, dict):
            for key, value in raw_analysis.items():
                symbol = "".join(ch for ch in str(key or "") if ch.isdigit()).zfill(6)
                if len(symbol) != 6 or not isinstance(value, dict):
                    continue
                entry = {
                    field: str(value[field]).strip()
                    for field in ETF_ANALYSIS_FIELDS
                    if value.get(field) is not None and str(value[field]).strip()
                }
                if entry.get("index_code"):
                    analysis[symbol] = entry
        config["etf"]["analysis"] = analysis
    if isinstance(payload.get("sources"), dict):
        items = payload["sources"].get("QUOTE")
        if isinstance(items, list):
            config["sources"]["QUOTE"] = [
                {
                    "name": str(item.get("name", "")).strip(),
                    "url": str(item.get("url", "")).strip(),
                    "role": str(item.get("role", "")).strip(),
                }
                for item in items
                if isinstance(item, dict) and item.get("name") and item.get("url")
            ]
    return config


def public_config(config=None):
    payload = json.loads(json.dumps(config if config is not None else CONFIG))
    try:
        from .defaults import ETF_ANALYSIS_REGISTRY
        from .dividend import analysis_support_map

        registry = {symbol: dict(entry) for symbol, entry in ETF_ANALYSIS_REGISTRY.items()}
        custom = (payload.get("etf") or {}).get("analysis") or {}
        if isinstance(custom, dict):
            for symbol, entry in custom.items():
                if isinstance(entry, dict):
                    registry[symbol] = {**registry.get(symbol, {}), **entry}
        payload.setdefault("etf", {})["analysis_registry"] = registry
        payload["etf"]["analysis_support"] = analysis_support_map()
    except Exception:
        payload.setdefault("etf", {})["analysis_support"] = {}
    return payload


def save_config(payload):
    global CONFIG
    _set_config(normalize_config(payload))
    CONFIG_PATH.write_text(json.dumps(CONFIG, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    QUOTE_CACHE["expires"] = 0
    QUOTE_MARKET_CACHE.clear()
    try:
        from .dividend import clear_dividend_cache

        clear_dividend_cache()
    except Exception:
        pass
    return CONFIG


def get_config():
    return CONFIG


def quote_settings():
    return CONFIG.get("quotes", DEFAULT_CONFIG["quotes"])


def etf_settings():
    return CONFIG.get("etf", DEFAULT_CONFIG["etf"])

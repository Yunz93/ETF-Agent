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
    try:
        from .blob_store import CONFIG_BLOB_PATH, hydrate_local_json

        hydrate_local_json(CONFIG_BLOB_PATH, CONFIG_PATH)
    except Exception:
        pass
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
    if isinstance(payload.get("ai"), dict):
        raw_ai = payload["ai"]
        provider = str(raw_ai.get("provider") or "deepseek").strip().lower()
        config["ai"]["enabled"] = raw_ai.get("enabled") is True
        config["ai"]["provider"] = provider if provider in ("deepseek", "openai") else "deepseek"
        raw_models = raw_ai.get("models") if isinstance(raw_ai.get("models"), dict) else {}
        for name in ("deepseek", "openai"):
            model = str(raw_models.get(name) or config["ai"]["models"][name]).strip()
            if model and len(model) <= 80:
                config["ai"]["models"][name] = model
        for field, minimum, maximum in (
            ("timeout_seconds", 10, 120),
            ("max_output_tokens", 400, 4000),
            ("cache_minutes", 0, 1440),
        ):
            try:
                value = int(raw_ai.get(field, config["ai"][field]))
            except (TypeError, ValueError):
                value = config["ai"][field]
            config["ai"][field] = min(maximum, max(minimum, value))
        try:
            max_increase = float(raw_ai.get("max_increase_multiplier", 1.5))
        except (TypeError, ValueError):
            max_increase = 1.5
        config["ai"]["max_increase_multiplier"] = min(1.5, max(1.0, max_increase))
    if isinstance(payload.get("quotes"), dict):
        config["quotes"].update(payload["quotes"])
        config["quotes"]["auto_refresh_enabled"] = payload["quotes"].get("auto_refresh_enabled") is not False
        try:
            refresh_seconds = int(payload["quotes"].get("refresh_interval_seconds", 300))
        except (TypeError, ValueError):
            refresh_seconds = 300
        config["quotes"]["refresh_interval_seconds"] = refresh_seconds if refresh_seconds >= 30 else 300
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
        products = {}
        raw_products = etf.get("products") or {}
        if isinstance(raw_products, dict):
            for key, value in raw_products.items():
                symbol = "".join(ch for ch in str(key or "") if ch.isdigit()).zfill(6)
                if len(symbol) != 6 or not isinstance(value, dict):
                    continue
                entry = {}
                for field in ETF_PRODUCT_FIELDS:
                    try:
                        number = float(value.get(field))
                    except (TypeError, ValueError):
                        continue
                    if number >= 0:
                        entry[field] = number
                if entry:
                    products[symbol] = entry
        config["etf"]["products"] = products
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
        from .secret_store import credential_status

        payload.setdefault("ai", {})["credentials"] = {
            name: credential_status(name) for name in ("deepseek", "openai")
        }
    except Exception:
        payload.setdefault("ai", {})["credentials"] = {
            name: {"configured": False, "source": None} for name in ("deepseek", "openai")
        }
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
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(CONFIG, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    try:
        from .blob_store import CONFIG_BLOB_PATH, persist_json

        persist_json(CONFIG_BLOB_PATH, CONFIG)
    except Exception as exc:
        from .blob_store import blob_enabled

        if blob_enabled():
            raise RuntimeError(f"durable config save failed: {exc}") from exc
    QUOTE_CACHE["expires"] = 0
    QUOTE_MARKET_CACHE.clear()
    AI_REVIEW_CACHE.clear()
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


def ai_settings():
    return CONFIG.get("ai", DEFAULT_CONFIG["ai"])

#!/usr/bin/env python3
"""Configuration loading, normalization, and persistence."""

import csv
import http.cookiejar
import json
import mimetypes
import os
import re
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, time as datetime_time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from zoneinfo import ZoneInfo

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
    if isinstance(payload.get("catalog"), dict):
        config["catalog"].update(payload["catalog"])
    if isinstance(payload.get("sec"), dict):
        config["sec"].update(payload["sec"])
    if isinstance(payload.get("dividend"), dict):
        config["dividend"].update(payload["dividend"])
    if isinstance(payload.get("ai"), dict):
        config["ai"].update(payload["ai"])
        config["ai"] = normalize_ai_config(config["ai"], payload.get("ai") or {})
    if isinstance(payload.get("sources"), dict):
        for key in ("QUOTE", "A", "HK", "US"):
            items = payload["sources"].get(key)
            if isinstance(items, list):
                config["sources"][key] = [
                    {
                        "name": str(item.get("name", "")).strip(),
                        "url": str(item.get("url", "")).strip(),
                        "role": str(item.get("role", "")).strip(),
                    }
                    for item in items
                    if isinstance(item, dict) and item.get("name") and item.get("url")
                ]
    return config


def normalize_ai_config(merged, incoming):
    provider = str(merged.get("provider") or "deepseek").strip().lower() or "deepseek"
    if provider not in AI_PROVIDER_PRESETS:
        provider = "custom"
    preset = AI_PROVIDER_PRESETS[provider]
    api_key = str(merged.get("api_key") or "").strip()
    # Settings UI masks secrets as ******** / empty means "keep existing key".
    if isinstance(incoming, dict):
        raw_incoming = incoming.get("api_key")
        if raw_incoming is None or str(raw_incoming).strip() in ("", "********"):
            api_key = str((CONFIG.get("ai") or {}).get("api_key") or "").strip()
        else:
            api_key = str(raw_incoming).strip()
    if api_key == "********":
        api_key = str((CONFIG.get("ai") or {}).get("api_key") or "").strip()
    base_url = str(merged.get("base_url") or preset.get("base_url") or "").strip().rstrip("/")
    model = str(merged.get("model") or preset.get("model") or "").strip()
    provider_name = str(merged.get("provider_name") or preset.get("provider_name") or provider).strip()
    try:
        temperature = float(merged.get("temperature", 0.3))
    except (TypeError, ValueError):
        temperature = 0.3
    try:
        max_tokens = int(merged.get("max_tokens", 2800))
    except (TypeError, ValueError):
        max_tokens = 2800
    try:
        timeout_seconds = int(merged.get("timeout_seconds", 90))
    except (TypeError, ValueError):
        timeout_seconds = 90
    return {
        "enabled": bool(merged.get("enabled", True)),
        "provider": provider,
        "provider_name": provider_name or preset.get("provider_name") or provider,
        "base_url": base_url,
        "model": model,
        "api_key": api_key,
        "temperature": max(0.0, min(temperature, 2.0)),
        "max_tokens": max(256, min(max_tokens, 8192)),
        "timeout_seconds": max(15, min(timeout_seconds, 180)),
        "note": str(merged.get("note") or DEFAULT_CONFIG["ai"]["note"]).strip(),
    }


def public_config(config=None):
    payload = json.loads(json.dumps(config if config is not None else CONFIG))
    ai = payload.get("ai") or {}
    api_key = str(ai.get("api_key") or "").strip()
    ai["has_api_key"] = bool(api_key)
    ai["api_key"] = "********" if api_key else ""
    payload["ai"] = ai
    return payload


def ai_settings():
    return CONFIG.get("ai", DEFAULT_CONFIG["ai"])


def save_config(payload):
    global CONFIG
    _set_config(normalize_config(payload))
    CONFIG_PATH.write_text(json.dumps(CONFIG, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    QUOTE_CACHE["expires"] = 0
    QUOTE_MARKET_CACHE.clear()
    CATALOG_CACHE["expires"] = 0
    return CONFIG


def get_config():
    return CONFIG
def quote_settings():
    return CONFIG.get("quotes", DEFAULT_CONFIG["quotes"])


def sec_settings():
    return CONFIG.get("sec", DEFAULT_CONFIG["sec"])
def catalog_settings():
    return CONFIG.get("catalog", DEFAULT_CONFIG.get("catalog", {}))

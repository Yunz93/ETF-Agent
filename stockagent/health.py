#!/usr/bin/env python3
"""Runtime data health and application metadata helpers."""

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

from .paths import *
from .defaults import INDEX_UNIVERSES
from .state import *
from .config_store import quote_settings
from .catalog import catalog_stock_tuples, get_catalog, refresh_catalog
from .quotes import fetch_quotes_for_stocks, get_quotes, get_single_quote, probe_quote_accuracy
from .financials import get_financials
from .symbols import as_of
from .market_time import format_market_time, market_freshness, market_timezone


def get_data_health():
    catalog = refresh_catalog()
    now = time.time()
    max_age = int(quote_settings().get("max_age_seconds", 1800))
    markets = {}
    quote_provider = None
    quote_error = None
    for market in ("A", "HK", "US"):
        first_index = (INDEX_UNIVERSES.get(market) or [{}])[0].get("code")
        sample = catalog_stock_tuples(market, first_index)[:120]
        payload = fetch_quotes_for_stocks(sample, market)
        quote_provider = payload.get("provider") or quote_provider
        if payload.get("error"):
            quote_error = payload.get("error")
        rows = payload.get("quotes", [])
        timestamps = [row.get("market_timestamp") for row in rows if row.get("market_timestamp")]
        newest = max(timestamps) if timestamps else None
        age = max(0, int(now - newest)) if newest else None
        freshness = market_freshness(market, newest, now=now, max_age=max_age)
        valuation_ok = sum(1 for row in rows if row.get("pe") is not None and row.get("pb") is not None)
        markets[market] = {
            "count": len(rows),
            "catalog_count": catalog["markets"][market]["count"],
            "sample_requested": len(sample),
            "indices": catalog["markets"][market]["indices"],
            "latest_market_time": format_market_time(newest, market),
            "age_seconds": age,
            "valuation_fields_ok": valuation_ok,
            "valuation_coverage": round(valuation_ok / len(rows), 3) if rows else 0,
            **freshness,
        }
    financial_probes = {
        "A": get_financials("600519", "A"),
        "HK": get_financials("0700", "HK"),
        "US": get_financials("AAPL", "US"),
    }
    financials = {
        market: {
            "ok": bool(result.get("financials")),
            "rows": len(result.get("financials") or []),
            "provider": result.get("provider"),
            "source_url": result.get("source_url"),
            "error": result.get("error"),
        }
        for market, result in financial_probes.items()
    }
    accuracy = probe_quote_accuracy()
    healthy = all(
        item["catalog_count"] > 0 and item["count"] > 0 and item["fresh"] for item in markets.values()
    ) and bool(financials["A"]["ok"] and financials["HK"]["ok"] and financials["US"]["ok"]) and accuracy["ok"]
    return {
        "status": "ok" if healthy else "degraded",
        "quote_provider": quote_provider,
        "quote_error": quote_error,
        "catalog_total": catalog["total"],
        "markets": markets,
        "financials": financials,
        "accuracy": accuracy,
        "timing_notes": {
            "live_max_age_seconds": min(max_age, 900),
            "configured_max_age_seconds": max_age,
            "session_model": "A/HK split around lunch; US continuous 09:30–16:00 ET",
            "quote_cache_ttl_seconds": 60,
            "pe_note": "腾讯与东方财富 PE 口径可能不同；交叉校验以价格和 PB 为准",
        },
        "checked_at": as_of(None),
    }

def financial_result_is_usable(result):
    rows = result.get("financials") or []
    if not rows:
        return False
    latest = rows[-1]
    return bool(
        latest.get("revenue")
        and latest.get("net_income")
        and latest.get("operating_cashflow")
        and (latest.get("gross_margin") or latest.get("roe"))
    )
def get_runtime_info():
    version = "0.0.0"
    try:
        from desktop.version import __version__ as desktop_version

        version = desktop_version
    except Exception:
        pass
    return {
        "app": "StockAgent",
        "version": version,
        "mode": "desktop" if os.environ.get("STOCKAGENT_DESKTOP") == "1" else "server",
        "resource_root": str(RESOURCE_ROOT),
        "data_dir": str(DATA_DIR),
        "config_path": str(CONFIG_PATH),
        "workspace_path": str(WORKSPACE_PATH),
        "catalog_cache_path": str(CATALOG_DISK_CACHE),
        "platform": sys.platform,
        "python": sys.version.split()[0],
        "frozen": bool(getattr(sys, "frozen", False)),
    }

#!/usr/bin/env python3
"""Runtime data health and application metadata helpers."""

import datetime
import os
import sys
import time

from .paths import CONFIG_PATH, DATA_DIR, WORKSPACE_PATH
from .config_store import etf_settings, quote_settings
from .quotes import get_etf_quotes, probe_quote_accuracy
from .dividend import dividend_settings, fetch_danjuan_valuation, fetch_treasury_yield_history
from .sentiment import probe_sentiment_sources
from .http_client import http_get_json
from .defaults import YAHOO_UA
from .symbols import as_of
from .market_time import format_market_time, market_freshness


def get_data_health():
    now = time.time()
    max_age = int(quote_settings().get("max_age_seconds", 1800))
    pool = [item["symbol"] for item in etf_settings().get("pool") or []]

    quotes_payload = get_etf_quotes(pool)
    rows = quotes_payload.get("quotes", [])
    timestamps = [row.get("market_timestamp") for row in rows if row.get("market_timestamp")]
    newest = max(timestamps) if timestamps else None
    freshness = market_freshness("A", newest, now=now, max_age=max_age)
    etf_block = {
        "pool_size": len(pool),
        "returned": len(rows),
        "provider": quotes_payload.get("provider"),
        "error": quotes_payload.get("error"),
        "latest_market_time": format_market_time(newest, "A"),
        "age_seconds": max(0, int(now - newest)) if newest else None,
        **freshness,
    }

    dividend_sources = probe_dividend_sources()
    accuracy = probe_quote_accuracy()
    sentiment_sources = probe_sentiment_sources()

    healthy = (
        bool(rows)
        and etf_block["fresh"]
        and accuracy["ok"]
        and all(item["ok"] for item in dividend_sources.values())
    )
    # Sentiment is soft: report separately; failure does not fail whole health.
    return {
        "status": "ok" if healthy else "degraded",
        "etf_quotes": etf_block,
        "dividend_sources": dividend_sources,
        "sentiment_sources": sentiment_sources,
        "accuracy": accuracy,
        "timing_notes": {
            "live_max_age_seconds": min(max_age, 900),
            "configured_max_age_seconds": max_age,
            "session_model": "A 股上午/下午两节，午休与休市判定内建",
            "quote_cache_ttl_seconds": 60,
            "sentiment_cache_ttl_seconds": 1800,
        },
        "checked_at": as_of(None),
    }


def probe_dividend_sources():
    """轻量探测红利低波仪表盘的三个数据源，不拉全量历史。"""
    settings = dividend_settings()
    results = {}

    index_code = settings.get("index_code", "H30269")
    end = datetime.date.today()
    start = end - datetime.timedelta(days=14)
    try:
        payload = http_get_json(
            "https://www.csindex.com.cn/csindex-home/perf/index-perf?"
            f"indexCode={index_code}&startDate={start.strftime('%Y%m%d')}&endDate={end.strftime('%Y%m%d')}",
            headers={"User-Agent": YAHOO_UA, "Accept": "application/json", "Referer": "https://www.csindex.com.cn/"},
            timeout=20,
        )
        rows = payload.get("data") or []
        results["csindex"] = {"ok": bool(rows), "rows": len(rows)}
    except Exception as exc:
        results["csindex"] = {"ok": False, "error": str(exc)}

    try:
        valuation = fetch_danjuan_valuation(settings.get("danjuan_code", "CSIH30269"))
        results["danjuan"] = {"ok": True, "pe": valuation.get("pe"), "date": valuation.get("date")}
    except Exception as exc:
        results["danjuan"] = {"ok": False, "error": str(exc)}

    try:
        rows = fetch_treasury_yield_history(pages=1, page_size=5)
        results["treasury"] = {"ok": bool(rows), "latest": rows[-1] if rows else None}
    except Exception as exc:
        results["treasury"] = {"ok": False, "error": str(exc)}

    return results


def durable_storage_backend():
    """Return ``blob`` when Vercel Blob credentials are configured, else ``local``."""
    try:
        from .blob_store import blob_enabled

        if blob_enabled():
            return "blob"
    except Exception:
        pass
    return "local"


def is_ephemeral_storage():
    """True when writable state is not durable (e.g. Vercel ``/tmp`` without Blob)."""
    if durable_storage_backend() == "blob":
        return False
    flag = os.environ.get("STOCKAGENT_EPHEMERAL", "").strip().lower()
    if flag in {"1", "true", "yes", "on"}:
        return True
    if flag in {"0", "false", "no", "off"}:
        return False
    try:
        resolved = str(DATA_DIR.resolve())
    except OSError:
        resolved = str(DATA_DIR)
    return resolved == "/tmp" or resolved.startswith("/tmp/")


def get_runtime_info():
    version = "0.0.0"
    try:
        from desktop.version import __version__ as desktop_version

        version = desktop_version
    except Exception:
        pass
    from .paths import resource_root, resolve_static_path

    root = resource_root()
    index = resolve_static_path("/index.html")
    backend = durable_storage_backend()
    ephemeral = is_ephemeral_storage()
    blob_auth = None
    try:
        from .blob_store import blob_auth_kind

        blob_auth = blob_auth_kind()
    except Exception:
        blob_auth = None
    return {
        "app": "ETF Agent",
        "version": version,
        "mode": "desktop" if os.environ.get("STOCKAGENT_DESKTOP") == "1" else "server",
        "resource_root": str(root),
        "index_html": bool(index),
        "data_dir": str(DATA_DIR),
        "config_path": str(CONFIG_PATH),
        "workspace_path": str(WORKSPACE_PATH),
        "durable_storage": backend,
        "ephemeral_storage": ephemeral,
        "blob_auth": blob_auth,
        "platform": sys.platform,
        "python": sys.version.split()[0],
        "frozen": bool(getattr(sys, "frozen", False)),
    }

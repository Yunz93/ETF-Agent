#!/usr/bin/env python3
"""Workspace persistence and normalization."""

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

from .defaults import DEFAULT_WORKSPACE
from .paths import WORKSPACE_LOCK, WORKSPACE_PATH

def empty_workspace():
    return json.loads(json.dumps(DEFAULT_WORKSPACE))


def normalize_workspace(payload):
    workspace = empty_workspace()
    if not isinstance(payload, dict):
        return workspace

    if isinstance(payload.get("watchlist"), dict):
        workspace["watchlist"] = payload["watchlist"]
    if isinstance(payload.get("holdings"), dict):
        workspace["holdings"] = payload["holdings"]
    if isinstance(payload.get("notes"), dict):
        workspace["notes"] = payload["notes"]
    if isinstance(payload.get("alertHistory"), list):
        workspace["alertHistory"] = payload["alertHistory"][:100]
    if isinstance(payload.get("prefs"), dict):
        prefs = payload["prefs"]
        workspace["prefs"] = {
            "notify": bool(prefs.get("notify", False)),
            "baseCurrency": str(prefs.get("baseCurrency") or "CNY").upper()
            if str(prefs.get("baseCurrency") or "CNY").upper() in {"CNY", "HKD", "USD"}
            else "CNY",
        }
    if isinstance(payload.get("customSymbols"), list):
        custom = []
        for item in payload["customSymbols"]:
            if not isinstance(item, dict) or not item.get("symbol") or not item.get("market"):
                continue
            custom.append(
                {
                    "symbol": str(item.get("symbol", "")).strip().upper(),
                    "name": str(item.get("name") or item.get("symbol") or "").strip(),
                    "englishName": str(item.get("englishName") or item.get("name") or "").strip(),
                    "market": str(item.get("market", "")).strip().upper(),
                    "exchange": str(item.get("exchange") or item.get("market") or "").strip(),
                    "currency": str(item.get("currency") or "CNY").strip().upper(),
                    "industry": str(item.get("industry") or "自定义").strip() or "自定义",
                }
            )
        workspace["customSymbols"] = custom

    workspace["version"] = int(payload.get("version") or 1)
    workspace["updated_at"] = payload.get("updated_at") or as_of(None)
    return workspace


def workspace_has_user_data(workspace):
    if not isinstance(workspace, dict):
        return False
    return bool(
        workspace.get("watchlist")
        or workspace.get("holdings")
        or workspace.get("notes")
        or workspace.get("alertHistory")
        or workspace.get("customSymbols")
    )


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
        workspace["version"] = int(workspace.get("version") or 1)
        temp_path = WORKSPACE_PATH.with_suffix(".json.tmp")
        temp_path.write_text(json.dumps(workspace, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temp_path.replace(WORKSPACE_PATH)
        return workspace

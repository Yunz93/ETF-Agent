#!/usr/bin/env python3
"""HTTP request handler and routes."""

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

from .paths import RESOURCE_ROOT
from .config_store import public_config, save_config
from .workspace_store import get_workspace, save_workspace
from .ai import analyze_stock_with_ai, list_ai_providers, test_ai_connection
from .catalog import get_catalog
from .quotes import get_price_history, get_quotes, get_single_quote
from .financials import get_financials, get_sec_filings, get_sec_financials
from .health import get_data_health, get_runtime_info

mimetypes.add_type("application/javascript", ".js")

class Handler(BaseHTTPRequestHandler):
    def do_HEAD(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            return
        if parsed.path == "/":
            path = "/index.html"
        else:
            path = parsed.path
        target = (RESOURCE_ROOT / path.lstrip("/")).resolve()
        if not str(target).startswith(str(RESOURCE_ROOT)) or not target.exists() or target.is_dir():
            self.send_error(404)
            return
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(target.stat().st_size))
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        if parsed.path == "/api/config":
            self.send_json(public_config())
            return
        if parsed.path == "/api/ai/providers":
            self.send_json(list_ai_providers())
            return
        if parsed.path == "/api/catalog":
            market = query.get("market", [""])[0].upper()
            index = query.get("index", [""])[0].strip().upper()
            self.send_json(get_catalog(market or None, index or None))
            return
        if parsed.path == "/api/quotes":
            market = query.get("market", [""])[0].upper()
            index = query.get("index", [""])[0].strip().upper()
            limit_raw = query.get("limit", [""])[0].strip()
            offset_raw = query.get("offset", ["0"])[0].strip() or "0"
            limit = int(limit_raw) if limit_raw.isdigit() else None
            offset = int(offset_raw) if offset_raw.isdigit() else 0
            self.send_json(get_quotes(market or None, index or None, limit=limit, offset=offset))
            return
        if parsed.path == "/api/health":
            self.send_json(get_data_health())
            return
        if parsed.path == "/api/ready":
            # Lightweight liveness for desktop launch — must not touch markets.
            self.send_json(
                {
                    "ready": True,
                    "app": "StockAgent",
                    "mode": "desktop" if os.environ.get("STOCKAGENT_DESKTOP") == "1" else "server",
                    "frozen": bool(getattr(sys, "frozen", False)),
                }
            )
            return
        if parsed.path == "/api/sec-financials":
            query = urllib.parse.parse_qs(parsed.query)
            symbol = query.get("symbol", [""])[0].upper()
            self.send_json(get_sec_financials(symbol))
            return
        if parsed.path == "/api/financials":
            query = urllib.parse.parse_qs(parsed.query)
            symbol = query.get("symbol", [""])[0].upper()
            market = query.get("market", [""])[0].upper()
            self.send_json(get_financials(symbol, market))
            return
        if parsed.path == "/api/sec-filings":
            query = urllib.parse.parse_qs(parsed.query)
            symbol = query.get("symbol", [""])[0].upper()
            self.send_json(get_sec_filings(symbol))
            return
        if parsed.path == "/api/quote":
            query = urllib.parse.parse_qs(parsed.query)
            symbol = query.get("symbol", [""])[0].strip().upper()
            market = query.get("market", [""])[0].strip().upper()
            self.send_json(get_single_quote(symbol, market))
            return
        if parsed.path == "/api/history":
            query = urllib.parse.parse_qs(parsed.query)
            symbol = query.get("symbol", [""])[0].strip().upper()
            market = query.get("market", [""])[0].strip().upper()
            range_key = query.get("range", ["1y"])[0].strip().lower() or "1y"
            self.send_json(get_price_history(symbol, market, range_key))
            return
        if parsed.path == "/api/workspace":
            self.send_json(get_workspace())
            return
        if parsed.path == "/api/runtime":
            self.send_json(get_runtime_info())
            return
        self.serve_static(parsed.path)

    def do_PUT(self):
        parsed = urllib.parse.urlparse(self.path)
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(body.decode("utf-8"))
        except json.JSONDecodeError as exc:
            self.send_json({"error": f"JSON 格式错误: {exc}"}, status=400)
            return

        try:
            if parsed.path == "/api/config":
                self.send_json(public_config(save_config(payload)))
                return
            if parsed.path == "/api/workspace":
                self.send_json(save_workspace(payload))
                return
            self.send_error(404)
        except Exception as exc:
            self.send_json({"error": str(exc)}, status=500)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(body.decode("utf-8") if body else "{}")
        except json.JSONDecodeError as exc:
            self.send_json({"error": f"JSON 格式错误: {exc}"}, status=400)
            return

        try:
            if parsed.path == "/api/ai/analyze":
                self.send_json(*analyze_stock_with_ai(payload))
                return
            if parsed.path == "/api/ai/test":
                self.send_json(*test_ai_connection(payload))
                return
            if parsed.path == "/api/config":
                self.send_json(public_config(save_config(payload)))
                return
            if parsed.path == "/api/workspace":
                self.send_json(save_workspace(payload))
                return
            self.send_error(404)
        except Exception as exc:
            self.send_json({"error": str(exc)}, status=500)

    def serve_static(self, path):
        if path == "/":
            path = "/index.html"
        target = (RESOURCE_ROOT / path.lstrip("/")).resolve()
        if not str(target).startswith(str(RESOURCE_ROOT)) or not target.exists() or target.is_dir():
            self.send_error(404)
            return
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, payload, status=200):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))

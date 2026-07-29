#!/usr/bin/env python3
"""HTTP request handler and routes."""

import json
import mimetypes
import os
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler

from .paths import RESOURCE_ROOT, resolve_static_path
from .config_store import public_config, save_config
from .workspace_store import get_workspace, save_workspace
from .dividend import analysis_support_map, get_dividend_dashboard
from .quotes import get_etf_quotes, get_price_history, get_single_quote
from .health import get_data_health, get_runtime_info
from .ai_providers import AIProviderError
from .ai_service import ai_status, review_recommendation, test_connection
from .secret_store import delete_api_key, save_api_key

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("text/html", ".html")

class Handler(BaseHTTPRequestHandler):
    def do_HEAD(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            return
        target = resolve_static_path(parsed.path)
        if target is None:
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
        try:
            if parsed.path == "/api/config":
                self.send_json(public_config())
                return
            if parsed.path == "/api/dividend/daily":
                refresh = query.get("refresh", ["0"])[0] in ("1", "true")
                symbol = query.get("symbol", [""])[0].strip()
                self.send_json(get_dividend_dashboard(refresh=refresh, symbol=symbol or None))
                return
            if parsed.path == "/api/etf/analysis-map":
                raw = query.get("symbols", [""])[0]
                symbols = [part.strip() for part in raw.replace("，", ",").split(",") if part.strip()] or None
                self.send_json({"items": analysis_support_map(symbols)})
                return
            if parsed.path == "/api/etf/quotes":
                raw = query.get("symbols", [""])[0]
                symbols = [part.strip() for part in raw.replace("，", ",").split(",") if part.strip()]
                self.send_json(get_etf_quotes(symbols))
                return
            if parsed.path == "/api/quote":
                symbol = query.get("symbol", [""])[0].strip()
                self.send_json(get_single_quote(symbol, "A"))
                return
            if parsed.path == "/api/history":
                symbol = query.get("symbol", [""])[0].strip().upper()
                range_key = query.get("range", ["1y"])[0].strip().lower() or "1y"
                self.send_json(get_price_history(symbol, "A", range_key))
                return
            if parsed.path == "/api/workspace":
                self.send_json(get_workspace())
                return
            if parsed.path == "/api/health":
                self.send_json(get_data_health())
                return
            if parsed.path == "/api/ai/status":
                self.send_json(ai_status())
                return
            if parsed.path == "/api/ready":
                # Lightweight liveness for desktop launch — must not touch markets.
                index = resolve_static_path("/index.html")
                self.send_json(
                    {
                        "ready": True,
                        "app": "ETF Agent",
                        "mode": "desktop" if os.environ.get("STOCKAGENT_DESKTOP") == "1" else "server",
                        "frozen": bool(getattr(sys, "frozen", False)),
                        "index_html": bool(index),
                        "resource_root": str(RESOURCE_ROOT),
                    }
                )
                return
            if parsed.path == "/api/runtime":
                self.send_json(get_runtime_info())
                return
        except Exception as exc:
            self.send_json({"error": str(exc)}, status=500)
            return
        self.serve_static(parsed.path)

    def do_PUT(self):
        self._handle_write()

    def do_POST(self):
        self._handle_write()

    def _handle_write(self):
        parsed = urllib.parse.urlparse(self.path)
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(body.decode("utf-8") if body else "{}")
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
            if parsed.path == "/api/ai/credentials":
                provider = payload.get("provider")
                if payload.get("delete") is True:
                    status = delete_api_key(provider)
                else:
                    status = save_api_key(provider, payload.get("api_key"))
                self.send_json({"provider": provider, **status})
                return
            if parsed.path == "/api/ai/test":
                self.send_json(test_connection(payload.get("provider")))
                return
            if parsed.path == "/api/ai/review-recommendation":
                self.send_json(
                    review_recommendation(
                        payload,
                        force=payload.get("force") is True,
                    )
                )
                return
            self.send_error(404)
        except AIProviderError as exc:
            self.send_json(
                {"error": str(exc), "code": exc.code},
                status=exc.status,
            )
        except Exception as exc:
            self.send_json({"error": str(exc)}, status=500)

    def serve_static(self, path):
        target = resolve_static_path(path)
        if target is None:
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

#!/usr/bin/env python3
"""Small HTTP helpers for JSON/text/bytes requests."""

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

def http_get_bytes(url, headers=None, timeout=45):
    request = urllib.request.Request(
        url,
        headers=headers
        or {
            "User-Agent": YAHOO_UA,
            "Accept": "*/*",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def http_get_text(url, headers=None, timeout=45, encoding="utf-8"):
    return http_get_bytes(url, headers=headers, timeout=timeout).decode(encoding, errors="replace")


def http_get_json(url, headers=None, timeout=45):
    return json.loads(http_get_text(url, headers=headers, timeout=timeout))


def http_post_json(url, payload, headers=None, timeout=90):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request_headers = {
        "User-Agent": YAHOO_UA,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if headers:
        request_headers.update(headers)
    request = urllib.request.Request(url, data=data, headers=request_headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
            return response.getcode(), json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            detail = {"error": raw or str(exc)}
        return exc.code, detail
def fetch_json(url, user_agent=None):
    user_agent = user_agent or sec_settings().get("user_agent", DEFAULT_CONFIG["sec"]["user_agent"])
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": user_agent,
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=12) as response:
        return json.loads(response.read().decode("utf-8"))

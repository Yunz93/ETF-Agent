#!/usr/bin/env python3
"""Symbol normalization and numeric field helpers."""

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

from .defaults import EASTMONEY_NYSE, GICS_SECTOR_ZH

def stock_tuple(symbol, market):
    symbol = normalize_symbol(symbol, market)
    market = market.upper()
    refresh_catalog()
    entry = CATALOG_CACHE["by_key"].get((market, symbol))
    if entry:
        return (entry["symbol"], entry["market"], entry["yahoo_symbol"])
    yahoo = infer_yahoo_symbol(symbol, market)
    return (symbol, market, yahoo)


def normalize_symbol(symbol, market):
    symbol = str(symbol or "").strip().upper()
    market = str(market or "").strip().upper()
    if market == "HK":
        digits = "".join(ch for ch in symbol if ch.isdigit())
        return digits.zfill(4) if digits else symbol
    if market == "A":
        digits = "".join(ch for ch in symbol if ch.isdigit())
        return digits.zfill(6) if digits else symbol
    return symbol.replace("/", ".")


def infer_yahoo_symbol(symbol, market):
    symbol = normalize_symbol(symbol, market)
    if market == "A":
        return f"{symbol}.{'SS' if symbol.startswith(('5', '6', '9')) else 'SZ'}"
    if market == "HK":
        return f"{symbol.zfill(4)}.HK"
    return symbol.replace(".", "-")
def a_share_exchange(symbol):
    if symbol.startswith(("5", "6", "9")):
        return "SSE", f"{symbol}.SS"
    return "SZSE", f"{symbol}.SZ"


def normalize_industry(value):
    text = str(value or "").strip()
    if not text or text in {"-", "None", "null", "未分类"}:
        return "未分类"
    # Strip trailing sector level markers like "白酒Ⅱ"
    text = re.sub(r"[ⅠⅡⅢIV]+$", "", text).strip() or text
    # Strip leading industry code like "J66 "
    parts = text.split(" ", 1)
    if len(parts) == 2 and parts[0][:1].isalpha() and parts[0][1:].isdigit():
        return parts[1]
    return text
def industry_needs_enrichment(value):
    text = normalize_industry(value)
    return text in {"未分类", "恒生成分", "标普500", "自定义"}
def tencent_code(symbol, market, yahoo_symbol):
    if market == "A":
        return f"{'sh' if yahoo_symbol.endswith('.SS') else 'sz'}{symbol}"
    if market == "HK":
        return f"hk{symbol.zfill(5)}"
    return f"us{symbol}"
def eastmoney_secid(symbol, market, yahoo_symbol):
    if market == "A":
        return f"{'1' if yahoo_symbol.endswith('.SS') else '0'}.{symbol}"
    if market == "HK":
        return f"116.{symbol.zfill(5)}"
    # Eastmoney US ulist rejects dotted class shares (e.g. BRK.B); Tencent remains primary.
    if "." in symbol:
        return None
    return f"{'106' if symbol.upper() in EASTMONEY_NYSE else '105'}.{symbol}"
def clean_market_value(value):
    if value in (None, "-", ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def scaled_market_value(value, divisor):
    value = clean_market_value(value)
    return round(value / divisor, 4) if value is not None else None
def field_at(fields, index):
    return fields[index] if index < len(fields) else None
def first_number(row, names):
    for name in names:
        value = row.get(name)
        if value not in (None, "", "-"):
            try:
                return float(value)
            except (TypeError, ValueError):
                continue
    return None
def timestamp_to_date(value):
    if not value:
        return None
    try:
        return time.strftime("%Y-%m-%d", time.localtime(int(value)))
    except (TypeError, ValueError, OSError):
        return None
def normalize_yield(value):
    if value is None:
        return None
    return value * 100 if value < 1 else value


def as_of(timestamp):
    if timestamp:
        return time.strftime("%Y-%m-%d %H:%M", time.localtime(timestamp))
    return time.strftime("%Y-%m-%d %H:%M")


def scale_millions(value):
    if value is None:
        return 0
    return round(value / 1_000_000)


def growth(value, previous):
    if not value or not previous:
        return 0
    return round((value - previous) / abs(previous) * 100, 1)


def ratio(numerator, denominator):
    if not numerator or not denominator:
        return 0
    return round(numerator / denominator * 100, 1)

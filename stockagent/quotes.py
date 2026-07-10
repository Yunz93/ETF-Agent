#!/usr/bin/env python3
"""Quote, history, and provider-specific parsing helpers."""

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
from .state import *
from .config_store import quote_settings
from .http_client import http_get_text
from .symbols import *
from .market_time import *
from .catalog import catalog_stock_tuples, index_meta_by_code

def get_quotes(market=None, index=None, limit=None, offset=0):
    market = market.upper() if market else None
    index = index.upper() if index else None
    if index:
        index_market, meta = index_meta_by_code(index)
        if not meta:
            return {"quotes": [], "error": "Unsupported index", "updated_at": as_of(None)}
        market = index_market
    if market and market not in {"A", "HK", "US"}:
        return {"quotes": [], "error": "Unsupported market", "updated_at": as_of(None)}

    now = time.time()
    offset = max(0, int(offset or 0))
    limit_value = int(limit) if limit not in (None, "") else None
    cache_key = f"{market or 'ALL'}|{index or '-'}|{offset}|{limit_value or 'ALL'}"
    cached = QUOTE_MARKET_CACHE.get(cache_key)
    if cached and cached["expires"] > now and (cached["payload"].get("quotes") or not cached["payload"].get("error")):
        return cached["payload"]

    stocks = catalog_stock_tuples(market, index)
    total = len(stocks)
    if limit_value is not None:
        stocks = stocks[offset : offset + max(0, limit_value)]
    else:
        stocks = stocks[offset:]
    response = fetch_quotes_for_stocks(stocks, market)
    response.update(
        {
            "index": index,
            "index_name": (index_meta_by_code(index)[1] or {}).get("name") if index else None,
            "offset": offset,
            "limit": limit_value,
            "total": total,
            "next_offset": offset + len(stocks) if offset + len(stocks) < total else None,
            "has_more": offset + len(stocks) < total,
        }
    )
    ttl = 60 if response.get("quotes") and not response.get("error") else 10
    QUOTE_MARKET_CACHE[cache_key] = {"expires": now + ttl, "payload": response}
    QUOTE_CACHE["payload"] = response
    QUOTE_CACHE["expires"] = now + ttl
    return response


def fetch_quotes_for_stocks(stocks, market=None):
    if not stocks:
        return {
            "quotes": [],
            "provider": quote_settings().get("provider_name", "腾讯行情"),
            "source_url": "https://gu.qq.com/",
            "updated_at": as_of(None),
            "market": market,
            "error": "成分股目录为空",
        }
    try:
        by_tencent = fetch_tencent_quotes(stocks)
        quotes = []
        missing = []
        for symbol, item_market, yahoo_symbol in stocks:
            item = by_tencent.get((item_market, symbol))
            if not item:
                missing.append((symbol, item_market, yahoo_symbol))
                continue
            quotes.append(quote_from_tencent_item(symbol, item_market, yahoo_symbol, item))
        filled = 0
        if missing:
            try:
                by_eastmoney = fetch_eastmoney_quotes(missing)
                for symbol, item_market, yahoo_symbol in missing:
                    item = by_eastmoney.get((item_market, symbol))
                    if not item:
                        continue
                    quote = quote_from_eastmoney_item(symbol, item_market, yahoo_symbol, item)
                    quote["note"] = "腾讯未返回该标的，东方财富补齐"
                    quotes.append(quote)
                    filled += 1
            except Exception:
                pass
        response = {
            "quotes": quotes,
            "provider": quote_settings().get("provider_name", "腾讯行情"),
            "source_url": "https://gu.qq.com/",
            "updated_at": as_of(None),
            "market": market,
            "requested": len(stocks),
            "returned": len(quotes),
        }
        if filled:
            response["provider"] = "腾讯行情 + 东方财富补齐"
            response["fallback_filled"] = filled
        if not quotes:
            raise RuntimeError("腾讯行情未返回任何有效行情")
        return response
    except Exception as exc:
        return get_eastmoney_fallback_quotes(exc, stocks, market)


def get_eastmoney_fallback_quotes(primary_error, stocks=None, market=None):
    stocks = stocks or catalog_stock_tuples(market)
    try:
        by_eastmoney = fetch_eastmoney_quotes(stocks)
        quotes = []
        for symbol, item_market, yahoo_symbol in stocks:
            item = by_eastmoney.get((item_market, symbol))
            if item:
                quote = quote_from_eastmoney_item(symbol, item_market, yahoo_symbol, item)
                quote["note"] = f"腾讯行情不可用，东方财富兜底；主源错误：{primary_error}"
                quotes.append(quote)
        return {
            "quotes": quotes,
            "provider": "东方财富（兜底）",
            "source_url": "https://quote.eastmoney.com/",
            "warning": str(primary_error),
            "updated_at": as_of(None),
            "market": market,
            "requested": len(stocks),
            "returned": len(quotes),
        }
    except Exception as fallback_error:
        return {
            "quotes": [],
            "provider": quote_settings().get("provider_name", "腾讯行情"),
            "error": f"腾讯行情：{primary_error}；东方财富：{fallback_error}",
            "updated_at": as_of(None),
            "market": market,
        }


def get_single_quote(symbol, market):
    if not symbol or market not in {"A", "HK", "US"}:
        return {"error": "需要有效的 market 与 symbol", "quote": None}
    symbol, market, yahoo_symbol = stock_tuple(symbol, market)
    stocks = [(symbol, market, yahoo_symbol)]
    try:
        by_tencent = fetch_tencent_quotes(stocks)
        item = by_tencent.get((market, symbol))
        if item:
            quote = quote_from_tencent_item(symbol, market, yahoo_symbol, item)
            name = field_at(item, 1) or symbol
            return {
                "quote": quote,
                "meta": {
                    "symbol": symbol,
                    "market": market,
                    "name": name,
                    "englishName": name,
                    "exchange": {"A": "SSE/SZSE", "HK": "HKEX", "US": "US"}.get(market, market),
                    "currency": {"A": "CNY", "HK": "HKD", "US": "USD"}[market],
                    "industry": "自定义",
                },
                "provider": quote.get("provider"),
                "updated_at": as_of(None),
            }
    except Exception as primary_error:
        try:
            by_eastmoney = fetch_eastmoney_quotes(stocks)
            item = by_eastmoney.get((market, symbol))
            if item:
                quote = quote_from_eastmoney_item(symbol, market, yahoo_symbol, item)
                quote["note"] = f"腾讯行情不可用，东方财富兜底；主源错误：{primary_error}"
                name = item.get("f58") or symbol
                return {
                    "quote": quote,
                    "meta": {
                        "symbol": symbol,
                        "market": market,
                        "name": name,
                        "englishName": name,
                        "exchange": {"A": "SSE/SZSE", "HK": "HKEX", "US": "US"}.get(market, market),
                        "currency": {"A": "CNY", "HK": "HKD", "US": "USD"}[market],
                        "industry": "自定义",
                    },
                    "provider": quote.get("provider"),
                    "updated_at": as_of(None),
                }
            return {"error": f"未找到行情：{primary_error}", "quote": None}
        except Exception as fallback_error:
            return {"error": f"腾讯：{primary_error}；东方财富：{fallback_error}", "quote": None}
    return {"error": "未找到行情", "quote": None}


def get_price_history(symbol, market, range_key="1y"):
    if not symbol or market not in {"A", "HK", "US"}:
        return {"error": "需要有效的 market 与 symbol", "points": []}
    symbol, market, yahoo_symbol = stock_tuple(symbol, market)
    allowed = {"1m": "1mo", "3m": "3mo", "6m": "6mo", "1y": "1y", "5y": "5y"}
    yahoo_range = allowed.get(range_key, "1y")
    cache_key = f"{market}:{symbol}:{yahoo_range}"
    now = time.time()
    cached = HISTORY_CACHE.get(cache_key)
    if cached and cached["expires"] > now:
        return cached["payload"]

    errors = []
    points = []
    provider_name = "Yahoo Finance"
    source_url = f"https://finance.yahoo.com/quote/{urllib.parse.quote(yahoo_symbol)}"

    url = (
        "https://query2.finance.yahoo.com/v8/finance/chart/"
        f"{urllib.parse.quote(yahoo_symbol, safe='')}?interval=1d&range={yahoo_range}"
    )
    try:
        opener = get_yahoo_bootstrap_opener()
        request = urllib.request.Request(url, headers=yahoo_headers())
        with opener.open(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
        chart_result = (payload.get("chart") or {}).get("result") or []
        if not chart_result:
            raise RuntimeError("Yahoo chart 无数据")
        result = chart_result[0]
        timestamps = result.get("timestamp") or []
        closes = ((result.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
        for ts, close in zip(timestamps, closes):
            if close is None:
                continue
            points.append(
                {
                    "date": time.strftime("%Y-%m-%d", time.gmtime(ts)),
                    "close": round(float(close), 4),
                }
            )
        if not points:
            raise RuntimeError("Yahoo chart 无有效收盘价")
    except Exception as exc:
        errors.append(f"Yahoo: {exc}")
        try:
            points = fetch_eastmoney_history(symbol, market, yahoo_symbol, range_key)
            provider_name = "东方财富"
            source_url = "https://quote.eastmoney.com/"
            if not points:
                raise RuntimeError("东方财富 K 线无数据")
        except Exception as fallback_error:
            errors.append(f"东方财富: {fallback_error}")
            return {
                "symbol": symbol,
                "market": market,
                "yahoo_symbol": yahoo_symbol,
                "range": range_key,
                "points": [],
                "error": "；".join(errors),
                "updated_at": as_of(None),
            }

    response_payload = {
        "symbol": symbol,
        "market": market,
        "yahoo_symbol": yahoo_symbol,
        "range": range_key,
        "points": points,
        "provider": provider_name,
        "source_url": source_url,
        "updated_at": as_of(None),
    }
    if errors:
        response_payload["warning"] = "；".join(errors)
    HISTORY_CACHE[cache_key] = {"expires": now + 300, "payload": response_payload}
    return response_payload


def history_limit(range_key):
    return {"1m": 30, "3m": 90, "6m": 180, "1y": 260, "5y": 1300}.get(range_key, 260)


def fetch_eastmoney_history(symbol, market, yahoo_symbol, range_key="1y"):
    secid = eastmoney_secid(symbol, market, yahoo_symbol)
    limit = history_limit(range_key)
    params = {
        "secid": secid,
        "klt": "101",
        "fqt": "1",
        "lmt": str(limit),
        "end": "20500101",
        "fields1": "f1,f2,f3,f4,f5,f6",
        "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
    }
    url = "https://push2his.eastmoney.com/api/qt/stock/kline/get?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": YAHOO_UA,
            "Accept": "application/json,text/plain,*/*",
            "Referer": "https://quote.eastmoney.com/",
        },
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        payload = json.loads(response.read().decode("utf-8"))
    klines = ((payload.get("data") or {}).get("klines")) or []
    points = []
    for row in klines:
        parts = str(row).split(",")
        if len(parts) < 3:
            continue
        try:
            points.append({"date": parts[0], "close": round(float(parts[2]), 4)})
        except (TypeError, ValueError):
            continue
    return points[-limit:]


def fetch_tencent_quotes(stocks):
    result = {}
    batch_size = int(quote_settings().get("batch_size", 80))
    for index in range(0, len(stocks), batch_size):
        batch = stocks[index : index + batch_size]
        codes = [tencent_code(symbol, market, yahoo) for symbol, market, yahoo in batch]
        url = "https://qt.gtimg.cn/q=" + ",".join(codes)
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": YAHOO_UA,
                "Accept": "text/plain,*/*",
                "Referer": "https://gu.qq.com/",
            },
        )
        with urllib.request.urlopen(request, timeout=20) as response:
            text = response.read().decode("gb18030", errors="replace")
        parsed = parse_tencent_response(text)
        for symbol, market, yahoo in batch:
            item = parsed.get(tencent_code(symbol, market, yahoo).lower())
            if item:
                result[(market, symbol)] = item
        if index + batch_size < len(stocks):
            time.sleep(0.05)
    return result


def parse_tencent_response(text):
    parsed = {}
    for line in text.splitlines():
        if "=" not in line:
            continue
        variable, raw = line.split("=", 1)
        code = variable.removeprefix("v_").strip().lower()
        value = raw.strip().strip(";").strip('"')
        fields = value.split("~")
        if len(fields) > 6 and fields[3] not in ("", "0"):
            parsed[code] = fields
    return parsed


def tencent_numeric(fields, *indexes):
    """Return the first parseable numeric field; skip blanks and non-numeric labels."""
    for index in indexes:
        value = clean_market_value(field_at(fields, index))
        if value is not None:
            return value
    return None


def tencent_valuation_fields(market, fields):
    """
    Tencent qt.gtimg.cn field layout differs by market after the shared price block.

    Shared: [3]=price, [32]=change%, [36]/[6]=volume, [39]=PE, [44]/[45]=mkt cap (亿元)
    A:      [46]=PB, [67]/[68]≈52w high/low
    HK:     [46]=ticker text, [57]=PE(alt), [58]=PB, [48]/[49]=52w high/low
    US:     [46]=company name, [51]=PB, [48]/[49]=52w high/low
    """
    market_cap_yi = tencent_numeric(fields, 45, 44)
    market_cap = market_cap_yi * 100_000_000 if market_cap_yi is not None else None
    if market == "A":
        return {
            "market_cap": market_cap,
            "pe": tencent_numeric(fields, 39),
            "pb": tencent_numeric(fields, 46),
            "week_52_high": tencent_numeric(fields, 67),
            "week_52_low": tencent_numeric(fields, 68),
        }
    if market == "HK":
        return {
            "market_cap": market_cap,
            "pe": tencent_numeric(fields, 57, 39),
            "pb": tencent_numeric(fields, 58),
            "week_52_high": tencent_numeric(fields, 48),
            "week_52_low": tencent_numeric(fields, 49),
        }
    return {
        "market_cap": market_cap,
        "pe": tencent_numeric(fields, 39),
        "pb": tencent_numeric(fields, 51),
        "week_52_high": tencent_numeric(fields, 48),
        "week_52_low": tencent_numeric(fields, 49),
    }


def quote_from_tencent_item(symbol, market, yahoo_symbol, fields):
    market_time = parse_market_timestamp(field_at(fields, 30), market)
    valuation = tencent_valuation_fields(market, fields)
    return {
        "symbol": symbol,
        "market": market,
        "yahoo_symbol": yahoo_symbol,
        "price": clean_market_value(field_at(fields, 3)),
        "change_pct": clean_market_value(field_at(fields, 32)),
        "volume": clean_market_value(field_at(fields, 36) or field_at(fields, 6)),
        "market_cap": valuation["market_cap"],
        "pe": valuation["pe"],
        "pb": valuation["pb"],
        "ps": None,
        "dividend_yield": None,
        "week_52_low": valuation["week_52_low"],
        "week_52_high": valuation["week_52_high"],
        "earnings_date": None,
        "ex_dividend_date": None,
        "as_of": format_market_time(market_time, market),
        "market_timestamp": market_time,
        "provider": quote_settings().get("provider_name", "腾讯行情"),
        "source_url": "https://gu.qq.com/",
        "note": quote_settings().get("note", ""),
    }
def fetch_eastmoney_quotes(stocks):
    # ulist.np uses clist-style fields (f2/f3/...), not stock/get fields (f43/f170/...).
    fields = ",".join(["f2", "f3", "f5", "f9", "f12", "f14", "f20", "f23", "f124"])
    prepared = []
    for symbol, market, yahoo in stocks:
        secid = eastmoney_secid(symbol, market, yahoo)
        if secid:
            prepared.append((symbol, market, yahoo, secid))
    if not prepared:
        return {}
    rows = fetch_eastmoney_ulist_rows([item[3] for item in prepared], fields, batch_size=20)
    by_code = {}
    for item in rows:
        code = str(item.get("f12", "")).upper()
        if not code:
            continue
        by_code[code] = item
        by_code[code.lstrip("0") or "0"] = item
    result = {}
    for symbol, market, _, _ in prepared:
        key = symbol.upper()
        item = by_code.get(key) or by_code.get(key.lstrip("0") or "0")
        if item:
            result[(market, symbol)] = item
    return result


def quote_from_eastmoney_item(symbol, market, yahoo_symbol, item):
    timestamp = item.get("f124")
    return {
        "symbol": symbol,
        "market": market,
        "yahoo_symbol": yahoo_symbol,
        "price": clean_market_value(item.get("f2")),
        "change_pct": clean_market_value(item.get("f3")),
        "volume": clean_market_value(item.get("f5")),
        "market_cap": clean_market_value(item.get("f20")),
        "pe": clean_market_value(item.get("f9")),
        "pb": clean_market_value(item.get("f23")),
        "ps": None,
        "dividend_yield": None,
        "week_52_low": None,
        "week_52_high": None,
        "earnings_date": None,
        "ex_dividend_date": None,
        "as_of": format_market_time(timestamp, market) if timestamp else as_of(timestamp),
        "market_timestamp": timestamp,
        "provider": "东方财富（兜底）",
        "source_url": "https://quote.eastmoney.com/",
        "note": quote_settings().get("note", ""),
    }


def probe_quote_accuracy():
    """Cross-check Tencent vs Eastmoney on liquid names; catch field-mapping regressions."""
    samples = [
        ("600519", "A", "600519.SS"),
        ("000001", "A", "000001.SZ"),
        ("0700", "HK", "0700.HK"),
        ("AAPL", "US", "AAPL"),
    ]
    checks = []
    for symbol, market, yahoo in samples:
        row = {"symbol": symbol, "market": market, "ok": False}
        try:
            by_tencent = fetch_tencent_quotes([(symbol, market, yahoo)])
            tencent_item = by_tencent.get((market, symbol))
            if not tencent_item:
                row["error"] = "腾讯无数据"
                checks.append(row)
                continue
            tencent_quote = quote_from_tencent_item(symbol, market, yahoo, tencent_item)
            row.update(
                {
                    "tencent_price": tencent_quote.get("price"),
                    "tencent_pe": tencent_quote.get("pe"),
                    "tencent_pb": tencent_quote.get("pb"),
                    "tencent_as_of": tencent_quote.get("as_of"),
                }
            )
            if tencent_quote.get("pb") is None or tencent_quote.get("pe") is None:
                row["error"] = "腾讯估值字段缺失（可能字段映射错误）"
                checks.append(row)
                continue
            if market == "US" and "." in symbol:
                row["ok"] = True
                row["note"] = "美股点号代码仅校验腾讯"
                checks.append(row)
                continue
            by_eastmoney = fetch_eastmoney_quotes([(symbol, market, yahoo)])
            east_item = by_eastmoney.get((market, symbol))
            if not east_item:
                row["ok"] = True
                row["note"] = "东方财富无对照样本，仅校验腾讯估值字段"
                checks.append(row)
                continue
            east_quote = quote_from_eastmoney_item(symbol, market, yahoo, east_item)
            row["eastmoney_price"] = east_quote.get("price")
            row["eastmoney_pe"] = east_quote.get("pe")
            row["eastmoney_pb"] = east_quote.get("pb")
            price_ok = prices_agree(tencent_quote.get("price"), east_quote.get("price"), rel=0.02, abs_tol=0.5)
            pe_ok = prices_agree(tencent_quote.get("pe"), east_quote.get("pe"), rel=0.35, abs_tol=5.0)
            pb_ok = prices_agree(tencent_quote.get("pb"), east_quote.get("pb"), rel=0.25, abs_tol=0.5)
            row["price_match"] = price_ok
            row["pe_match"] = pe_ok
            row["pb_match"] = pb_ok
            # PE definitions differ by vendor (TTM / static / diluted); require price + PB.
            row["ok"] = bool(price_ok and pb_ok)
            if not pe_ok:
                row["note"] = "PE 口径可能不同（腾讯 vs 东方财富），已记录但不作为硬失败"
            if not row["ok"]:
                row["error"] = "腾讯与东方财富交叉校验偏差过大"
        except Exception as exc:
            row["error"] = str(exc)
        checks.append(row)
    return {
        "ok": all(item.get("ok") for item in checks),
        "checks": checks,
    }


def prices_agree(left, right, rel=0.02, abs_tol=0.5):
    if left is None or right is None:
        return False
    try:
        left = float(left)
        right = float(right)
    except (TypeError, ValueError):
        return False
    if left == 0 and right == 0:
        return True
    scale = max(abs(left), abs(right), 1e-9)
    return abs(left - right) <= max(abs_tol, rel * scale)
def quote_from_yahoo_item(symbol, market, yahoo_symbol, item):
    quotes = quote_settings()
    return {
        "symbol": symbol,
        "market": market,
        "yahoo_symbol": yahoo_symbol,
        "price": item.get("regularMarketPrice"),
        "change_pct": item.get("regularMarketChangePercent"),
        "volume": item.get("regularMarketVolume"),
        "market_cap": item.get("marketCap"),
        "pe": item.get("trailingPE"),
        "pb": item.get("priceToBook"),
        "ps": item.get("priceToSalesTrailing12Months"),
        "dividend_yield": normalize_yield(item.get("trailingAnnualDividendYield")),
        "week_52_low": item.get("fiftyTwoWeekLow"),
        "week_52_high": item.get("fiftyTwoWeekHigh"),
        "earnings_date": timestamp_to_date(
            item.get("earningsTimestamp") or item.get("earningsTimestampStart")
        ),
        "ex_dividend_date": timestamp_to_date(item.get("exDividendDate")),
        "as_of": as_of(item.get("regularMarketTime")),
        "market_timestamp": item.get("regularMarketTime"),
        "provider": "Yahoo Finance",
        "source_url": "https://finance.yahoo.com/",
        "note": quotes.get("note", ""),
    }


def fetch_yahoo_quotes(yahoo_symbols, batch_size=None):
    if batch_size is None:
        batch_size = int(quote_settings().get("batch_size", 25))
    by_yahoo = {}
    v7_error = None
    try:
        for index in range(0, len(yahoo_symbols), batch_size):
            batch = yahoo_symbols[index : index + batch_size]
            url = "https://query2.finance.yahoo.com/v7/finance/quote?symbols=" + urllib.parse.quote(",".join(batch))
            payload = yahoo_fetch_json(url)
            for item in payload.get("quoteResponse", {}).get("result", []):
                symbol = item.get("symbol")
                if symbol:
                    by_yahoo[symbol] = item
            if index + batch_size < len(yahoo_symbols):
                time.sleep(0.25)
    except Exception as exc:
        v7_error = exc

    missing = [symbol for symbol in yahoo_symbols if symbol not in by_yahoo]
    if missing:
        by_yahoo.update(fetch_yahoo_chart_quotes(missing))

    if not by_yahoo and v7_error:
        raise v7_error
    return by_yahoo


def fetch_yahoo_chart_quotes(yahoo_symbols):
    opener = get_yahoo_bootstrap_opener()
    by_yahoo = {}
    for yahoo_symbol in yahoo_symbols:
        try:
            item = fetch_yahoo_chart_quote(opener, yahoo_symbol)
            if item:
                by_yahoo[yahoo_symbol] = item
        except Exception:
            continue
        time.sleep(0.12)
    return by_yahoo


def get_yahoo_bootstrap_opener():
    cookie_jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookie_jar))
    request = urllib.request.Request("https://finance.yahoo.com/quote/AAPL/", headers=yahoo_headers())
    opener.open(request, timeout=15).read()
    return opener


def fetch_yahoo_chart_quote(opener, yahoo_symbol):
    url = (
        "https://query2.finance.yahoo.com/v8/finance/chart/"
        f"{urllib.parse.quote(yahoo_symbol, safe='')}?interval=1d&range=5d"
    )
    request = urllib.request.Request(url, headers=yahoo_headers())
    with opener.open(request, timeout=15) as response:
        payload = json.loads(response.read().decode("utf-8"))
    chart_result = payload.get("chart", {}).get("result")
    if not chart_result:
        return None
    meta = chart_result[0].get("meta", {})
    price = meta.get("regularMarketPrice")
    if price is None:
        return None
    previous = meta.get("chartPreviousClose") or meta.get("previousClose")
    change_pct = round((price - previous) / previous * 100, 2) if previous else None
    return {
        "symbol": meta.get("symbol") or yahoo_symbol,
        "regularMarketPrice": price,
        "regularMarketChangePercent": change_pct,
        "regularMarketVolume": meta.get("regularMarketVolume"),
        "marketCap": None,
        "trailingPE": None,
        "priceToBook": None,
        "priceToSalesTrailing12Months": None,
        "trailingAnnualDividendYield": None,
        "fiftyTwoWeekLow": meta.get("fiftyTwoWeekLow"),
        "fiftyTwoWeekHigh": meta.get("fiftyTwoWeekHigh"),
        "earningsTimestamp": None,
        "earningsTimestampStart": None,
        "exDividendDate": None,
        "regularMarketTime": meta.get("regularMarketTime"),
    }


def yahoo_headers():
    return {
        "User-Agent": YAHOO_UA,
        "Accept": "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
    }


def invalidate_yahoo_session():
    YAHOO_SESSION["expires"] = 0
    YAHOO_SESSION["opener"] = None
    YAHOO_SESSION["crumb"] = None


def get_yahoo_session(force=False):
    now = time.time()
    with YAHOO_LOCK:
        if (
            not force
            and YAHOO_SESSION["opener"]
            and YAHOO_SESSION["crumb"]
            and YAHOO_SESSION["expires"] > now
        ):
            return YAHOO_SESSION["opener"], YAHOO_SESSION["crumb"]

        cookie_jar = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookie_jar))

        for bootstrap_url in (
            "https://finance.yahoo.com/quote/AAPL/",
            "https://fc.yahoo.com",
        ):
            request = urllib.request.Request(bootstrap_url, headers=yahoo_headers())
            try:
                opener.open(request, timeout=15).read()
            except urllib.error.HTTPError as exc:
                if exc.code not in {404, 403}:
                    raise
            except urllib.error.URLError:
                continue

        crumb_request = urllib.request.Request(
            "https://query2.finance.yahoo.com/v1/test/getcrumb",
            headers=yahoo_headers(),
        )
        crumb = opener.open(crumb_request, timeout=15).read().decode("utf-8").strip()
        if not crumb:
            raise RuntimeError("Yahoo crumb 为空")

        YAHOO_SESSION["opener"] = opener
        YAHOO_SESSION["crumb"] = crumb
        YAHOO_SESSION["expires"] = now + 3600
        return opener, crumb


def yahoo_fetch_json(url, retry=True):
    opener, crumb = get_yahoo_session(force=not retry)
    separator = "&" if "?" in url else "?"
    request = urllib.request.Request(
        f"{url}{separator}crumb={urllib.parse.quote(crumb)}",
        headers=yahoo_headers(),
    )
    try:
        with opener.open(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if retry and exc.code in {401, 403}:
            invalidate_yahoo_session()
            return yahoo_fetch_json(url, retry=False)
        raise RuntimeError(f"Yahoo API HTTP {exc.code}: {exc.reason}") from exc

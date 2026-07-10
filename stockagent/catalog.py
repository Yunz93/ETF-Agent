#!/usr/bin/env python3
"""Catalog constituent fetching, enrichment, and caching."""

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
from .config_store import catalog_settings
from .http_client import http_get_bytes, http_get_json, http_get_text
from .symbols import *

def eastmoney_quote_hosts():
    return ("push2delay.eastmoney.com", "push2.eastmoney.com")


def fetch_eastmoney_ulist_rows(secids, fields, batch_size=40):
    rows = []
    for index in range(0, len(secids), batch_size):
        batch = secids[index : index + batch_size]
        params = urllib.parse.urlencode(
            {
                "secids": ",".join(batch),
                "fields": fields,
                "fltt": 2,
                "invt": 2,
            }
        )
        last_error = None
        for host in eastmoney_quote_hosts():
            url = f"https://{host}/api/qt/ulist.np/get?{params}"
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": YAHOO_UA,
                    "Accept": "application/json,text/plain,*/*",
                    "Referer": "https://quote.eastmoney.com/",
                },
            )
            try:
                with urllib.request.urlopen(request, timeout=18) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                diff = (payload.get("data") or {}).get("diff") or []
                rows.extend(diff.values() if isinstance(diff, dict) else diff)
                last_error = None
                break
            except Exception as exc:
                last_error = exc
        if last_error and not rows:
            raise last_error
        time.sleep(0.03)
    return rows


def fetch_eastmoney_industry_map(stocks):
    """Map (market, symbol) -> industry via Eastmoney f100 for A/HK catalogs."""
    mapping = {}
    if not stocks:
        return mapping
    secids = []
    meta = []
    for stock in stocks:
        market = stock.get("market")
        if market not in {"A", "HK"}:
            continue
        symbol = stock.get("symbol")
        yahoo = stock.get("yahoo_symbol") or symbol
        secid = eastmoney_secid(symbol, market, yahoo)
        if not secid:
            continue
        secids.append(secid)
        meta.append((market, symbol))
    if not secids:
        return mapping
    rows = fetch_eastmoney_ulist_rows(secids, "f12,f14,f100", batch_size=40)
    by_code = {}
    for item in rows:
        code = str(item.get("f12") or "").upper()
        if not code:
            continue
        by_code[code] = item
        by_code[code.lstrip("0") or "0"] = item
    for market, symbol in meta:
        candidates = [
            symbol.upper(),
            symbol.upper().zfill(5 if market == "HK" else 6),
            (symbol.upper().lstrip("0") or "0"),
        ]
        if market == "HK":
            candidates.append(symbol.zfill(4).upper())
        item = None
        for candidate in candidates:
            item = by_code.get(candidate) or by_code.get(candidate.lstrip("0") or "0")
            if item:
                break
        if not item:
            continue
        industry = normalize_industry(item.get("f100"))
        if industry != "未分类":
            mapping[(market, symbol)] = industry
    return mapping


def fetch_sp500_sector_map():
    urls = (
        "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/master/data/constituents.csv",
        "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv",
    )
    text = None
    last_error = None
    for url in urls:
        try:
            text = http_get_text(url, headers={"User-Agent": YAHOO_UA, "Accept": "text/csv,*/*"}, timeout=45)
            break
        except Exception as exc:
            last_error = exc
    if text is None:
        raise RuntimeError(f"标普行业表拉取失败：{last_error}")
    reader = csv.DictReader(text.splitlines())
    mapping = {}
    for row in reader:
        symbol = str(row.get("Symbol") or "").strip().upper().replace("-", ".")
        sector = str(row.get("GICS Sector") or "").strip()
        if not symbol or not sector:
            continue
        label = GICS_SECTOR_ZH.get(sector, sector)
        mapping[symbol] = label
        mapping[symbol.replace(".", "-")] = label
    return mapping


def enrich_catalog_industries(stocks):
    if not stocks:
        return {"enriched": 0, "sources": []}
    enriched = 0
    sources = []
    a_hk = [
        stock
        for stock in stocks
        if stock.get("market") in {"A", "HK"} and industry_needs_enrichment(stock.get("industry"))
    ]
    us = [
        stock
        for stock in stocks
        if stock.get("market") == "US" and industry_needs_enrichment(stock.get("industry"))
    ]
    if a_hk:
        try:
            industry_map = fetch_eastmoney_industry_map(a_hk)
            for stock in a_hk:
                industry = industry_map.get((stock["market"], stock["symbol"]))
                if industry:
                    stock["industry"] = industry
                    enriched += 1
            sources.append(f"eastmoney:{len(industry_map)}")
        except Exception as exc:
            sources.append(f"eastmoney_error:{exc}")
    if us:
        try:
            sector_map = fetch_sp500_sector_map()
            for stock in us:
                industry = sector_map.get(stock["symbol"]) or sector_map.get(stock["symbol"].replace(".", "-"))
                if industry:
                    stock["industry"] = industry
                    enriched += 1
            sources.append(f"sp500_gics:{len(sector_map)}")
        except Exception as exc:
            sources.append(f"sp500_error:{exc}")
    return {"enriched": enriched, "sources": sources}


def parse_csindex_xls(data):
    try:
        import xlrd
    except ImportError as exc:
        raise RuntimeError("解析中证成分股需要 xlrd，请先 pip install xlrd") from exc
    book = xlrd.open_workbook(file_contents=data)
    sheet = book.sheet_by_index(0)
    records = []
    for row_index in range(1, sheet.nrows):
        code_raw = sheet.cell_value(row_index, 4)
        if isinstance(code_raw, float):
            code = str(int(code_raw)).zfill(6)
        else:
            code = "".join(ch for ch in str(code_raw) if ch.isdigit()).zfill(6)
        if not code or code == "000000":
            continue
        name = str(sheet.cell_value(row_index, 5) or "").strip()
        english = str(sheet.cell_value(row_index, 6) or "").strip()
        exchange = str(sheet.cell_value(row_index, 7) or "").strip()
        records.append(
            {
                "symbol": code,
                "name": name or code,
                "english_name": english or name or code,
                "exchange_name": exchange,
            }
        )
    return records


def fetch_csindex_constituents(index_code):
    url = (
        "https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/cons/"
        f"{index_code}cons.xls"
    )
    data = http_get_bytes(
        url,
        headers={
            "User-Agent": YAHOO_UA,
            "Referer": "https://www.csindex.com.cn/",
            "Accept": "*/*",
        },
        timeout=60,
    )
    return parse_csindex_xls(data)


def fetch_yfiua_constituents(code):
    url = f"https://yfiua.github.io/index-constituents/constituents-{code}.json"
    rows = http_get_json(url, headers={"User-Agent": YAHOO_UA, "Accept": "application/json"})
    result = []
    for row in rows:
        symbol = str(row.get("Symbol") or row.get("symbol") or "").strip()
        name = str(row.get("Name") or row.get("name") or symbol).strip()
        if not symbol:
            continue
        result.append({"symbol": symbol, "name": name, "english_name": name})
    return result


def fetch_sina_constituents(index_code):
    result = []
    seen = set()
    page = 1
    while page <= 200:
        url = (
            "https://vip.stock.finance.sina.com.cn/corp/view/vII_NewestComponent.php"
            f"?page={page}&indexid={index_code}"
        )
        text = http_get_text(
            url,
            headers={
                "User-Agent": YAHOO_UA,
                "Referer": "https://vip.stock.finance.sina.com.cn/",
                "Accept": "text/html,*/*",
            },
            timeout=45,
            encoding="gb18030",
        )
        table = None
        marker = 'id="NewStockTable"'
        start = text.find(marker)
        if start >= 0:
            end = text.find("</table>", start)
            if end >= 0:
                table = text[start:end]
        if not table:
            break
        pairs = []
        for match in __import__("re").finditer(
            r'<td><div align="center">(\d{6})</div></td>\s*'
            r'<td><div align="center"><a[^>]*>([^<]+)</a></div></td>',
            table,
        ):
            pairs.append((match.group(1), match.group(2).strip()))
        for symbol, name in pairs:
            if symbol in seen:
                continue
            seen.add(symbol)
            result.append({"symbol": symbol, "name": name, "english_name": name})
        pages = [int(value) for value in __import__("re").findall(rf"page=(\d+)&indexid={index_code}", text)]
        max_page = max(pages) if pages else page
        if page >= max_page:
            break
        page += 1
        time.sleep(0.05)
    return result


def build_a_share_entry(row, index_meta, source_name):
    symbol = str(row["symbol"]).zfill(6)
    exchange, yahoo_symbol = a_share_exchange(symbol)
    # Skip legacy B-shares for quote coverage quality.
    if symbol.startswith("900") or symbol.startswith("200"):
        return None
    return {
        "symbol": symbol,
        "name": row.get("name") or symbol,
        "englishName": row.get("english_name") or row.get("name") or symbol,
        "market": "A",
        "exchange": "SSE STAR" if symbol.startswith("688") else exchange,
        "currency": "CNY",
        "industry": normalize_industry(row.get("industry")),
        "yahoo_symbol": yahoo_symbol,
        "indices": [index_meta["name"]],
        "index_codes": [index_meta["code"]],
        "source": source_name,
    }


def build_hk_entry(row, index_meta, source_name):
    raw = str(row["symbol"]).upper().replace(".HK", "")
    digits = "".join(ch for ch in raw if ch.isdigit())
    if not digits:
        return None
    symbol = digits.zfill(4)[-4:]
    return {
        "symbol": symbol,
        "name": row.get("name") or symbol,
        "englishName": row.get("english_name") or row.get("name") or symbol,
        "market": "HK",
        "exchange": "HKEX",
        "currency": "HKD",
        "industry": normalize_industry(row.get("industry")) if row.get("industry") else "恒生成分",
        "yahoo_symbol": f"{symbol.zfill(4)}.HK",
        "indices": [index_meta["name"]],
        "index_codes": [index_meta["code"]],
        "source": source_name,
    }


def build_us_entry(row, index_meta, source_name, cik_map):
    symbol = str(row["symbol"]).upper().replace("-", ".")
    if not symbol or symbol.endswith(".WS") or symbol.endswith(".U"):
        return None
    return {
        "symbol": symbol,
        "name": row.get("name") or symbol,
        "englishName": row.get("english_name") or row.get("name") or symbol,
        "market": "US",
        "exchange": "US",
        "currency": "USD",
        "industry": "标普500",
        "yahoo_symbol": symbol.replace(".", "-"),
        "indices": [index_meta["name"]],
        "index_codes": [index_meta["code"]],
        "source": source_name,
        "cik": cik_map.get(symbol) or cik_map.get(symbol.replace(".", "-")),
    }


def load_sec_cik_map(force=False):
    now = time.time()
    if not force and SEC_CIK_CACHE["payload"] and SEC_CIK_CACHE["expires"] > now:
        return SEC_CIK_CACHE["payload"]
    url = "https://www.sec.gov/files/company_tickers.json"
    payload = http_get_json(
        url,
        headers={
            "User-Agent": sec_settings().get(
                "user_agent", "StockAgent/0.1 personal-local contact@example.com"
            ),
            "Accept": "application/json",
        },
        timeout=45,
    )
    mapping = {}
    for item in payload.values():
        ticker = str(item.get("ticker") or "").upper()
        cik = str(item.get("cik_str") or "").zfill(10)
        if ticker and cik:
            mapping[ticker] = cik
            mapping[ticker.replace("-", ".")] = cik
            mapping[ticker.replace(".", "-")] = cik
    SEC_CIK_CACHE["payload"] = mapping
    SEC_CIK_CACHE["expires"] = now + 24 * 3600
    return mapping


def merge_catalog_entry(bucket, entry):
    key = (entry["market"], entry["symbol"])
    existing = bucket.get(key)
    if not existing:
        bucket[key] = entry
        return
    indices = list(dict.fromkeys(existing.get("indices", []) + entry.get("indices", [])))
    index_codes = list(dict.fromkeys(existing.get("index_codes", []) + entry.get("index_codes", [])))
    existing["indices"] = indices
    existing["index_codes"] = index_codes
    if existing.get("industry") in (None, "", "未分类") and entry.get("industry"):
        existing["industry"] = entry["industry"]
    if (not existing.get("englishName") or existing["englishName"] == existing["symbol"]) and entry.get(
        "englishName"
    ):
        existing["englishName"] = entry["englishName"]
    if entry.get("cik") and not existing.get("cik"):
        existing["cik"] = entry["cik"]


def load_market_constituents(market):
    entries = {}
    index_stats = []
    errors = []
    cik_map = load_sec_cik_map() if market == "US" else {}
    for index_meta in INDEX_UNIVERSES.get(market, []):
        source = index_meta["source"]
        rows = []
        source_name = ""
        try:
            if source == "csindex":
                rows = fetch_csindex_constituents(index_meta["csindex_code"])
                source_name = "中证指数公司"
            elif source == "yfiua":
                try:
                    rows = fetch_yfiua_constituents(index_meta["yfiua_code"])
                    source_name = "index-constituents"
                except Exception as primary_error:
                    if index_meta.get("sina_code"):
                        rows = fetch_sina_constituents(index_meta["sina_code"])
                        source_name = "新浪财经成分股"
                    else:
                        raise primary_error
            elif source == "sina":
                rows = fetch_sina_constituents(index_meta["sina_code"])
                source_name = "新浪财经成分股"
            else:
                raise RuntimeError(f"未知成分股来源：{source}")
        except Exception as exc:
            errors.append(f"{index_meta['name']}: {exc}")
            index_stats.append(
                {
                    "code": index_meta["code"],
                    "name": index_meta["name"],
                    "count": 0,
                    "error": str(exc),
                }
            )
            continue

        built = 0
        for row in rows:
            if market == "A":
                entry = build_a_share_entry(row, index_meta, source_name)
            elif market == "HK":
                entry = build_hk_entry(row, index_meta, source_name)
            else:
                entry = build_us_entry(row, index_meta, source_name, cik_map)
            if not entry:
                continue
            merge_catalog_entry(entries, entry)
            built += 1
        index_stats.append(
            {
                "code": index_meta["code"],
                "name": index_meta["name"],
                "count": built,
                "source": source_name,
            }
        )
    return list(entries.values()), index_stats, errors


def _apply_catalog_payload(payload, expires):
    by_key = {}
    all_stocks = []
    for market in ("A", "HK", "US"):
        for stock in payload.get("markets", {}).get(market, {}).get("stocks", []):
            all_stocks.append(stock)
            by_key[(stock["market"], stock["symbol"])] = stock
    CATALOG_CACHE["payload"] = payload
    CATALOG_CACHE["by_key"] = by_key
    CATALOG_CACHE["stocks"] = all_stocks
    CATALOG_CACHE["expires"] = expires
    return payload


def load_catalog_disk_cache(cache_seconds):
    if not CATALOG_DISK_CACHE.exists():
        return None
    try:
        payload = json.loads(CATALOG_DISK_CACHE.read_text(encoding="utf-8"))
        saved_at = payload.get("_saved_at")
        if not saved_at or time.time() - float(saved_at) > cache_seconds:
            return None
        payload.pop("_saved_at", None)
        return payload
    except Exception:
        return None


def save_catalog_disk_cache(payload):
    try:
        data = json.loads(json.dumps(payload))
        data["_saved_at"] = time.time()
        CATALOG_DISK_CACHE.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    except Exception as exc:
        print(f"catalog disk cache write failed: {exc}")


def refresh_catalog(force=False):
    now = time.time()
    cache_seconds = int(catalog_settings().get("cache_seconds", 21600))
    if not force and CATALOG_CACHE["payload"] and CATALOG_CACHE["expires"] > now:
        return CATALOG_CACHE["payload"]

    if not force:
        disk_payload = load_catalog_disk_cache(cache_seconds)
        if disk_payload and disk_payload.get("total"):
            stocks = []
            for market in ("A", "HK", "US"):
                stocks.extend(disk_payload.get("markets", {}).get(market, {}).get("stocks", []))
            needs = sum(1 for stock in stocks if industry_needs_enrichment(stock.get("industry")))
            if needs > max(20, int(len(stocks) * 0.2)):
                industry_meta = enrich_catalog_industries(stocks)
                disk_payload["industry_enrichment"] = industry_meta
                save_catalog_disk_cache(disk_payload)
            return _apply_catalog_payload(disk_payload, now + cache_seconds)

    markets = {}
    all_stocks = []
    by_key = {}
    for market in ("A", "HK", "US"):
        stocks, index_stats, errors = load_market_constituents(market)
        stocks.sort(key=lambda item: (item.get("symbol") or ""))
        markets[market] = {
            "count": len(stocks),
            "indices": index_stats,
            "errors": errors,
            "stocks": stocks,
        }
        for stock in stocks:
            all_stocks.append(stock)
            by_key[(stock["market"], stock["symbol"])] = stock

    industry_meta = enrich_catalog_industries(all_stocks)

    payload = {
        "markets": markets,
        "total": len(all_stocks),
        "updated_at": as_of(None),
        "note": catalog_settings().get("note", ""),
        "industry_enrichment": industry_meta,
    }
    _apply_catalog_payload(payload, now + cache_seconds)
    save_catalog_disk_cache(payload)
    return payload


def index_meta_by_code(index_code):
    code = str(index_code or "").strip().upper()
    for market, items in INDEX_UNIVERSES.items():
        for item in items:
            if str(item.get("code", "")).upper() == code:
                return market, item
    return None, None


def filter_catalog_stocks(stocks, market=None, index=None):
    rows = stocks
    if market:
        market = market.upper()
        rows = [row for row in rows if row.get("market") == market]
    if index:
        index = str(index).upper()
        rows = [
            row
            for row in rows
            if index in [str(code).upper() for code in (row.get("index_codes") or [])]
        ]
    return rows


def get_catalog(market=None, index=None):
    payload = refresh_catalog()
    if index:
        index = index.upper()
        index_market, meta = index_meta_by_code(index)
        if not meta:
            return {"index": index, "count": 0, "stocks": [], "error": "Unsupported index"}
        stocks = filter_catalog_stocks(payload["markets"][index_market]["stocks"], index_market, index)
        return {
            "market": index_market,
            "index": index,
            "index_name": meta.get("name"),
            "count": len(stocks),
            "indices": [
                item
                for item in payload["markets"][index_market]["indices"]
                if str(item.get("code", "")).upper() == index
            ],
            "errors": payload["markets"][index_market]["errors"],
            "updated_at": payload["updated_at"],
            "note": payload["note"],
            "stocks": stocks,
        }
    if not market:
        return {
            "total": payload["total"],
            "updated_at": payload["updated_at"],
            "note": payload["note"],
            "markets": {
                key: {
                    "count": value["count"],
                    "indices": value["indices"],
                    "errors": value["errors"],
                }
                for key, value in payload["markets"].items()
            },
            "indices": [
                {
                    "code": item["code"],
                    "name": item["name"],
                    "market": market_key,
                }
                for market_key, items in INDEX_UNIVERSES.items()
                for item in items
            ],
            "stocks": payload["markets"]["A"]["stocks"]
            + payload["markets"]["HK"]["stocks"]
            + payload["markets"]["US"]["stocks"],
        }
    market = market.upper()
    if market not in payload["markets"]:
        return {"market": market, "count": 0, "stocks": [], "error": "Unsupported market"}
    section = payload["markets"][market]
    return {
        "market": market,
        "count": section["count"],
        "indices": section["indices"],
        "errors": section["errors"],
        "updated_at": payload["updated_at"],
        "note": payload["note"],
        "stocks": section["stocks"],
    }


def catalog_stock_tuples(market=None, index=None):
    refresh_catalog()
    stocks = filter_catalog_stocks(CATALOG_CACHE["stocks"], market, index)
    return [(row["symbol"], row["market"], row["yahoo_symbol"]) for row in stocks]

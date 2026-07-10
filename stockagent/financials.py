#!/usr/bin/env python3
"""Financial statement and SEC filing helpers."""

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

from .state import *
from .config_store import sec_settings
from .http_client import fetch_json, http_get_json
from .symbols import *
from .catalog import load_sec_cik_map

def get_sec_financials(symbol):
    if not sec_settings().get("enabled", True):
        return {"symbol": symbol, "financials": [], "error": "SEC 数据源已在配置中关闭"}
    if symbol not in load_sec_cik_map():
        return {"symbol": symbol, "financials": [], "error": "No CIK mapping"}
    cached = SEC_CACHE.get(symbol)
    now = time.time()
    if cached and cached["expires"] > now:
        return cached["payload"]

    url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{load_sec_cik_map()[symbol]}.json"
    try:
        facts = fetch_json(url)
        financials = parse_sec_financials(facts)
        payload = {
            "symbol": symbol,
            "provider": "SEC EDGAR companyfacts",
            "source_url": url,
            "financials": financials,
            "updated_at": as_of(None),
        }
    except Exception as exc:
        payload = {"symbol": symbol, "financials": [], "error": str(exc), "updated_at": as_of(None)}

    SEC_CACHE[symbol] = {"payload": payload, "expires": now + 3600}
    return payload


def get_financials(symbol, market):
    if market == "US":
        return get_sec_financials(symbol)
    if market not in {"A", "HK"}:
        return {"symbol": symbol, "market": market, "financials": [], "error": "Unsupported market"}
    cache_key = (market, symbol)
    cached = FINANCIAL_CACHE.get(cache_key)
    now = time.time()
    if cached and cached["expires"] > now:
        return cached["payload"]
    try:
        payload = get_eastmoney_financials(symbol, market)
    except Exception as exc:
        payload = {
            "symbol": symbol,
            "market": market,
            "financials": [],
            "error": str(exc),
            "updated_at": as_of(None),
        }
    FINANCIAL_CACHE[cache_key] = {"payload": payload, "expires": now + 3600}
    return payload


def get_eastmoney_financials(symbol, market):
    if market == "A":
        refresh_catalog()
        stock = CATALOG_CACHE["by_key"].get(("A", symbol))
        suffix = "SH" if stock and str(stock.get("yahoo_symbol", "")).endswith(".SS") else "SZ"
        secucode = f"{symbol}.{suffix}"
        report_name = "RPT_F10_FINANCE_MAINFINADATA"
    else:
        secucode = f"{symbol.zfill(5)}.HK"
        report_name = "RPT_HKF10_FN_MAININDICATOR"
    params = {
        "reportName": report_name,
        "columns": "ALL",
        "filter": f'(SECUCODE="{secucode}")',
        "pageNumber": 1,
        "pageSize": 12,
        "sortTypes": -1,
        "sortColumns": "REPORT_DATE",
    }
    url = "https://datacenter.eastmoney.com/securities/api/data/v1/get?" + urllib.parse.urlencode(params)
    data = fetch_json(url, user_agent=YAHOO_UA)
    rows = data.get("result", {}).get("data") or []
    financials = parse_eastmoney_financials(rows)
    return {
        "symbol": symbol,
        "market": market,
        "provider": "东方财富财务数据中心",
        "source_url": url,
        "currency": "CNY" if market == "A" else "HKD",
        "financials": financials,
        "updated_at": as_of(None),
    }


def parse_eastmoney_financials(data):
    aliases = {
        "revenue": [
            "TOTALOPERATEREVE",
            "TOTAL_OPERATE_INCOME",
            "OPERATE_INCOME",
            "TOTAL_REVENUE",
        ],
        "revenue_growth": [
            "TOTALOPERATEREVETZ",
            "YSTZ",
            "OPERATE_INCOME_YOY",
            "REVENUE_YOY",
        ],
        "gross_margin": ["MLL", "XSMLL", "GROSS_PROFIT_RATIO", "GROSS_MARGIN"],
        "net_income": [
            "PARENTNETPROFIT",
            "PARENT_NETPROFIT",
            "NETPROFIT",
            "HOLDER_PROFIT",
        ],
        "operating_cashflow": ["NETCASH_OPERATE", "OPERATE_CASH_FLOW"],
        "operating_cashflow_per_share": ["MGJYXJJE"],
        "debt_ratio": ["ZCFZL", "ASSET_LIAB_RATIO", "DEBT_ASSET_RATIO"],
        "roe": ["ROEJQ", "ROE_AVG", "ROE"],
        "eps": ["EPSJB", "BASIC_EPS", "EPS"],
    }
    parsed = []
    seen = set()
    for row in data:
        report_date = str(row.get("REPORT_DATE") or row.get("REPORTDATE") or "")[:10]
        if not report_date or report_date in seen:
            continue
        seen.add(report_date)
        revenue = first_number(row, aliases["revenue"])
        net_income = first_number(row, aliases["net_income"])
        eps = first_number(row, aliases["eps"])
        operating_cashflow = first_number(row, aliases["operating_cashflow"])
        cashflow_per_share = first_number(row, aliases["operating_cashflow_per_share"])
        if operating_cashflow is None and cashflow_per_share and net_income and eps:
            operating_cashflow = cashflow_per_share * (net_income / eps)
        parsed.append(
            {
                "period": report_date,
                "revenue": scale_millions(revenue),
                "revenue_growth": first_number(row, aliases["revenue_growth"]) or 0,
                "gross_margin": first_number(row, aliases["gross_margin"]) or 0,
                "net_income": scale_millions(net_income),
                "operating_cashflow": scale_millions(operating_cashflow),
                "debt_ratio": first_number(row, aliases["debt_ratio"]) or 0,
                "roe": first_number(row, aliases["roe"]) or 0,
                "eps": eps or 0,
            }
        )
        if len(parsed) >= 4:
            break
    return list(reversed(parsed))


def get_sec_filings(symbol):
    if not sec_settings().get("enabled", True):
        return {"symbol": symbol, "filings": [], "error": "SEC 数据源已在配置中关闭"}
    if symbol not in load_sec_cik_map():
        return {"symbol": symbol, "filings": [], "error": "No CIK mapping"}
    cached = FILINGS_CACHE.get(symbol)
    now = time.time()
    if cached and cached["expires"] > now:
        return cached["payload"]

    cik = load_sec_cik_map()[symbol]
    url = f"https://data.sec.gov/submissions/CIK{cik}.json"
    try:
        data = fetch_json(url)
        recent = data.get("filings", {}).get("recent", {})
        forms = recent.get("form", [])
        filing_dates = recent.get("filingDate", [])
        accessions = recent.get("accessionNumber", [])
        documents = recent.get("primaryDocument", [])
        cik_path = str(int(cik))
        filings = []
        for index, form in enumerate(forms):
            if form not in {"10-K", "10-Q", "8-K"}:
                continue
            accession = accessions[index].replace("-", "")
            doc = documents[index]
            filings.append(
                {
                    "date": filing_dates[index],
                    "form": form,
                    "title": f"{form} 披露",
                    "url": f"https://www.sec.gov/Archives/edgar/data/{cik_path}/{accession}/{doc}",
                }
            )
            if len(filings) >= 8:
                break
        payload = {
            "symbol": symbol,
            "provider": "SEC EDGAR submissions",
            "source_url": url,
            "filings": filings,
            "updated_at": as_of(None),
        }
    except Exception as exc:
        payload = {"symbol": symbol, "filings": [], "error": str(exc), "updated_at": as_of(None)}

    FILINGS_CACHE[symbol] = {"payload": payload, "expires": now + 3600}
    return payload


def parse_sec_financials(facts):
    us_gaap = facts.get("facts", {}).get("us-gaap", {})
    revenue = annual_values(us_gaap, ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"])
    gross_profit = annual_values(us_gaap, ["GrossProfit"])
    net_income = annual_values(us_gaap, ["NetIncomeLoss"])
    cashflow = annual_values(us_gaap, ["NetCashProvidedByUsedInOperatingActivities"])
    assets = annual_instant_values(us_gaap, ["Assets"])
    liabilities = annual_instant_values(us_gaap, ["Liabilities"])
    equity = annual_instant_values(us_gaap, ["StockholdersEquity"])
    eps = annual_values(us_gaap, ["EarningsPerShareDiluted"], unit="USD/shares")

    years = sorted(set(revenue) & set(net_income))[-4:]
    rows = []
    previous_revenue = None
    for year in years:
        rev = revenue.get(year)
        ni = net_income.get(year)
        gp = gross_profit.get(year)
        ocf = cashflow.get(year)
        asset = assets.get(year)
        liability = liabilities.get(year)
        eq = equity.get(year)
        row = {
            "period": f"{year} FY",
            "revenue": scale_millions(rev),
            "revenue_growth": growth(rev, previous_revenue),
            "gross_margin": ratio(gp, rev),
            "net_income": scale_millions(ni),
            "operating_cashflow": scale_millions(ocf),
            "debt_ratio": ratio(liability, asset),
            "roe": ratio(ni, eq),
            "eps": eps.get(year) or 0,
        }
        rows.append(row)
        previous_revenue = rev
    return rows


def annual_values(us_gaap, tags, unit="USD"):
    for tag in tags:
        units = us_gaap.get(tag, {}).get("units", {})
        values = units.get(unit) or next(iter(units.values()), [])
        result = {}
        for item in values:
            frame = item.get("frame") or ""
            form = item.get("form")
            if form not in {"10-K", "20-F", "40-F"}:
                continue
            if not frame.startswith("CY") or "Q" in frame:
                continue
            year = frame[2:6]
            if not year.isdigit() or item.get("val") is None:
                continue
            result[int(year)] = item["val"]
        if result:
            return result
    return {}


def annual_instant_values(us_gaap, tags, unit="USD"):
    for tag in tags:
        units = us_gaap.get(tag, {}).get("units", {})
        values = units.get(unit) or next(iter(units.values()), [])
        result = {}
        filed_by_year = {}
        for item in values:
            year = item.get("fy")
            if (
                item.get("form") not in {"10-K", "20-F", "40-F"}
                or item.get("fp") != "FY"
                or not isinstance(year, int)
                or item.get("val") is None
            ):
                continue
            filed = item.get("filed") or ""
            if filed >= filed_by_year.get(year, ""):
                result[year] = item["val"]
                filed_by_year[year] = filed
        if result:
            return result
    return {}

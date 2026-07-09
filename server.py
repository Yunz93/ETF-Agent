#!/usr/bin/env python3
import http.cookiejar
import json
import mimetypes
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, time as datetime_time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "config.json"
WORKSPACE_PATH = ROOT / "workspace.json"
WORKSPACE_LOCK = threading.Lock()

DEFAULT_WORKSPACE = {
    "version": 1,
    "updated_at": None,
    "watchlist": {},
    "holdings": {},
    "notes": {},
    "alertHistory": [],
    "prefs": {"notify": False, "baseCurrency": "CNY"},
    "customSymbols": [],
}

DEFAULT_CONFIG = {
    "server": {"port": 5174},
    "quotes": {
        "provider": "tencent",
        "provider_name": "腾讯行情",
        "note": "腾讯公开行情接口，东方财富自动兜底",
        "batch_size": 25,
        "max_age_seconds": 1800,
    },
    "sec": {
        "enabled": True,
        "user_agent": "StockAgent/0.1 personal-local contact@example.com",
    },
    "sources": {
        "QUOTE": [
            {
                "name": "腾讯行情",
                "url": "https://gu.qq.com/",
                "role": "实时/延迟行情和基础估值",
            }
        ],
        "A": [
            {
                "name": "巨潮资讯网",
                "url": "https://www.cninfo.com.cn/new/index",
                "role": "公告、财报与监管问询来源",
            }
        ],
        "HK": [
            {
                "name": "HKEXnews",
                "url": "https://www.hkexnews.hk/index.htm",
                "role": "港股上市公司公告来源",
            }
        ],
        "US": [
            {
                "name": "SEC EDGAR",
                "url": "https://www.sec.gov/search-filings/edgar-application-programming-interfaces",
                "role": "10-K、10-Q、XBRL companyfacts 来源",
            }
        ],
    },
}

CONFIG = json.loads(json.dumps(DEFAULT_CONFIG))

STOCKS = [
    ("600519", "A", "600519.SS"),
    ("300750", "A", "300750.SZ"),
    ("601318", "A", "601318.SS"),
    ("600036", "A", "600036.SS"),
    ("000858", "A", "000858.SZ"),
    ("002594", "A", "002594.SZ"),
    ("600276", "A", "600276.SS"),
    ("601899", "A", "601899.SS"),
    ("000333", "A", "000333.SZ"),
    ("601012", "A", "601012.SS"),
    ("600900", "A", "600900.SS"),
    ("600309", "A", "600309.SS"),
    ("688111", "A", "688111.SS"),
    ("300760", "A", "300760.SZ"),
    ("601088", "A", "601088.SS"),
    ("600887", "A", "600887.SS"),
    ("002415", "A", "002415.SZ"),
    ("000651", "A", "000651.SZ"),
    ("601166", "A", "601166.SS"),
    ("688981", "A", "688981.SS"),
    ("0700", "HK", "0700.HK"),
    ("9988", "HK", "9988.HK"),
    ("3690", "HK", "3690.HK"),
    ("1299", "HK", "1299.HK"),
    ("0388", "HK", "0388.HK"),
    ("0939", "HK", "0939.HK"),
    ("1398", "HK", "1398.HK"),
    ("2318", "HK", "2318.HK"),
    ("1810", "HK", "1810.HK"),
    ("1024", "HK", "1024.HK"),
    ("9618", "HK", "9618.HK"),
    ("9999", "HK", "9999.HK"),
    ("1211", "HK", "1211.HK"),
    ("0883", "HK", "0883.HK"),
    ("0005", "HK", "0005.HK"),
    ("2020", "HK", "2020.HK"),
    ("2269", "HK", "2269.HK"),
    ("9868", "HK", "9868.HK"),
    ("2015", "HK", "2015.HK"),
    ("1177", "HK", "1177.HK"),
    ("AAPL", "US", "AAPL"),
    ("MSFT", "US", "MSFT"),
    ("NVDA", "US", "NVDA"),
    ("AMZN", "US", "AMZN"),
    ("GOOGL", "US", "GOOGL"),
    ("META", "US", "META"),
    ("TSLA", "US", "TSLA"),
    ("BRK.B", "US", "BRK-B"),
    ("JPM", "US", "JPM"),
    ("V", "US", "V"),
    ("LLY", "US", "LLY"),
    ("UNH", "US", "UNH"),
    ("XOM", "US", "XOM"),
    ("COST", "US", "COST"),
    ("HD", "US", "HD"),
    ("NFLX", "US", "NFLX"),
    ("AMD", "US", "AMD"),
    ("KO", "US", "KO"),
    ("PEP", "US", "PEP"),
    ("ADBE", "US", "ADBE"),
]

SEC_CIK = {
    "AAPL": "0000320193",
    "MSFT": "0000789019",
    "NVDA": "0001045810",
    "AMZN": "0001018724",
    "GOOGL": "0001652044",
    "META": "0001326801",
    "TSLA": "0001318605",
    "BRK.B": "0001067983",
    "JPM": "0000019617",
    "V": "0001403161",
    "LLY": "0000059478",
    "UNH": "0000731766",
    "XOM": "0000034088",
    "COST": "0000909832",
    "HD": "0000354950",
    "NFLX": "0001065280",
    "AMD": "0000002488",
    "KO": "0000021344",
    "PEP": "0000077476",
    "ADBE": "0000796343",
}

QUOTE_CACHE = {"expires": 0, "payload": None}
HISTORY_CACHE = {}
SEC_CACHE = {}
FILINGS_CACHE = {}
FINANCIAL_CACHE = {}

YAHOO_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
YAHOO_SESSION = {"expires": 0, "opener": None, "crumb": None}
YAHOO_LOCK = threading.Lock()


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
        target = (ROOT / path.lstrip("/")).resolve()
        if not str(target).startswith(str(ROOT)) or not target.exists() or target.is_dir():
            self.send_error(404)
            return
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(target.stat().st_size))
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/config":
            self.send_json(get_config())
            return
        if parsed.path == "/api/quotes":
            self.send_json(get_quotes())
            return
        if parsed.path == "/api/health":
            self.send_json(get_data_health())
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
                self.send_json(save_config(payload))
                return
            if parsed.path == "/api/workspace":
                self.send_json(save_workspace(payload))
                return
            self.send_error(404)
        except Exception as exc:
            self.send_json({"error": str(exc)}, status=500)

    def do_POST(self):
        # Alias for clients that can only POST (e.g. some keepalive paths).
        self.do_PUT()

    def serve_static(self, path):
        if path == "/":
            path = "/index.html"
        target = (ROOT / path.lstrip("/")).resolve()
        if not str(target).startswith(str(ROOT)) or not target.exists() or target.is_dir():
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


def load_config():
    global CONFIG
    if CONFIG_PATH.exists():
        with CONFIG_PATH.open(encoding="utf-8") as handle:
            loaded = json.load(handle)
        CONFIG = normalize_config(loaded)
    else:
        CONFIG = json.loads(json.dumps(DEFAULT_CONFIG))
        save_config(CONFIG)
    return CONFIG


def normalize_config(payload):
    config = json.loads(json.dumps(DEFAULT_CONFIG))
    if isinstance(payload.get("server"), dict):
        config["server"].update(payload["server"])
    if isinstance(payload.get("quotes"), dict):
        config["quotes"].update(payload["quotes"])
    if isinstance(payload.get("sec"), dict):
        config["sec"].update(payload["sec"])
    if isinstance(payload.get("sources"), dict):
        for key in ("QUOTE", "A", "HK", "US"):
            items = payload["sources"].get(key)
            if isinstance(items, list):
                config["sources"][key] = [
                    {
                        "name": str(item.get("name", "")).strip(),
                        "url": str(item.get("url", "")).strip(),
                        "role": str(item.get("role", "")).strip(),
                    }
                    for item in items
                    if isinstance(item, dict) and item.get("name") and item.get("url")
                ]
    return config


def save_config(payload):
    global CONFIG
    CONFIG = normalize_config(payload)
    CONFIG_PATH.write_text(json.dumps(CONFIG, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    QUOTE_CACHE["expires"] = 0
    return CONFIG


def get_config():
    return CONFIG


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


def quote_settings():
    return CONFIG.get("quotes", DEFAULT_CONFIG["quotes"])


def sec_settings():
    return CONFIG.get("sec", DEFAULT_CONFIG["sec"])


def stock_tuple(symbol, market):
    symbol = normalize_symbol(symbol, market)
    market = market.upper()
    for item in STOCKS:
        if item[0] == symbol and item[1] == market:
            return item
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


def get_quotes():
    now = time.time()
    cached = QUOTE_CACHE["payload"]
    if cached and QUOTE_CACHE["expires"] > now and (cached.get("quotes") or not cached.get("error")):
        return cached

    try:
        by_tencent = fetch_tencent_quotes(STOCKS)
        quotes = []
        for symbol, market, yahoo_symbol in STOCKS:
            item = by_tencent.get((market, symbol))
            if not item:
                continue
            quotes.append(quote_from_tencent_item(symbol, market, yahoo_symbol, item))
        response = {
            "quotes": quotes,
            "provider": quote_settings().get("provider_name", "腾讯行情"),
            "source_url": "https://gu.qq.com/",
            "updated_at": as_of(None),
        }
        if not quotes:
            raise RuntimeError("腾讯行情未返回任何有效行情")
        QUOTE_CACHE["payload"] = response
        QUOTE_CACHE["expires"] = now + 60
    except Exception as exc:
        response = get_eastmoney_fallback_quotes(exc)
        QUOTE_CACHE["payload"] = response
        QUOTE_CACHE["expires"] = now + 10

    return response


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


def get_eastmoney_fallback_quotes(primary_error):
    try:
        by_eastmoney = fetch_eastmoney_quotes(STOCKS)
        quotes = []
        for symbol, market, yahoo_symbol in STOCKS:
            item = by_eastmoney.get((market, symbol))
            if item:
                quote = quote_from_eastmoney_item(symbol, market, yahoo_symbol, item)
                quote["note"] = f"腾讯行情不可用，东方财富兜底；主源错误：{primary_error}"
                quotes.append(quote)
        return {
            "quotes": quotes,
            "provider": "东方财富（兜底）",
            "source_url": "https://quote.eastmoney.com/",
            "warning": str(primary_error),
            "updated_at": as_of(None),
        }
    except Exception as fallback_error:
        return {
            "quotes": [],
            "provider": quote_settings().get("provider_name", "腾讯行情"),
            "error": f"腾讯行情：{primary_error}；东方财富：{fallback_error}",
            "updated_at": as_of(None),
        }


def tencent_code(symbol, market, yahoo_symbol):
    if market == "A":
        return f"{'sh' if yahoo_symbol.endswith('.SS') else 'sz'}{symbol}"
    if market == "HK":
        return f"hk{symbol.zfill(5)}"
    return f"us{symbol}"


def fetch_tencent_quotes(stocks):
    result = {}
    for index in range(0, len(stocks), 20):
        batch = stocks[index : index + 20]
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
        with urllib.request.urlopen(request, timeout=12) as response:
            text = response.read().decode("gb18030", errors="replace")
        parsed = parse_tencent_response(text)
        for symbol, market, yahoo in batch:
            item = parsed.get(tencent_code(symbol, market, yahoo).lower())
            if item:
                result[(market, symbol)] = item
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


def quote_from_tencent_item(symbol, market, yahoo_symbol, fields):
    market_time = parse_market_timestamp(field_at(fields, 30), market)
    market_cap = clean_market_value(field_at(fields, 45))
    return {
        "symbol": symbol,
        "market": market,
        "yahoo_symbol": yahoo_symbol,
        "price": clean_market_value(field_at(fields, 3)),
        "change_pct": clean_market_value(field_at(fields, 32)),
        "volume": clean_market_value(field_at(fields, 36) or field_at(fields, 6)),
        "market_cap": market_cap * 100_000_000 if market_cap is not None else None,
        "pe": clean_market_value(field_at(fields, 39) or field_at(fields, 45)),
        "pb": clean_market_value(field_at(fields, 46)),
        "ps": None,
        "dividend_yield": None,
        "week_52_low": None,
        "week_52_high": None,
        "earnings_date": None,
        "ex_dividend_date": None,
        "as_of": format_market_time(market_time, market),
        "market_timestamp": market_time,
        "provider": quote_settings().get("provider_name", "腾讯行情"),
        "source_url": "https://gu.qq.com/",
        "note": quote_settings().get("note", ""),
    }


def field_at(fields, index):
    return fields[index] if index < len(fields) else None


def market_timezone(market):
    return ZoneInfo(
        {
            "A": "Asia/Shanghai",
            "HK": "Asia/Hong_Kong",
            "US": "America/New_York",
        }.get(market, "Asia/Shanghai")
    )


def parse_market_timestamp(value, market):
    if not value:
        return None
    digits = "".join(character for character in value if character.isdigit())
    for length, pattern in ((14, "%Y%m%d%H%M%S"), (12, "%Y%m%d%H%M")):
        if len(digits) >= length:
            try:
                local_time = datetime.strptime(digits[:length], pattern).replace(
                    tzinfo=market_timezone(market)
                )
                return int(local_time.timestamp())
            except ValueError:
                pass
    return None


def format_market_time(timestamp, market):
    if not timestamp:
        return None
    labels = {"A": "CST", "HK": "HKT", "US": "ET"}
    value = datetime.fromtimestamp(timestamp, market_timezone(market))
    return f"{value:%Y-%m-%d %H:%M} {labels.get(market, '')}".strip()


def market_freshness(market, timestamp, now=None, max_age=1800):
    if not timestamp:
        return {"fresh": False, "status": "missing", "delay_seconds": None}
    now = now or time.time()
    age = max(0, int(now - timestamp))
    local_now = datetime.fromtimestamp(now, market_timezone(market))
    sessions = {
        "A": (datetime_time(9, 30), datetime_time(15, 0)),
        "HK": (datetime_time(9, 30), datetime_time(16, 0)),
        "US": (datetime_time(9, 30), datetime_time(16, 0)),
    }
    start, end = sessions[market]
    in_session = local_now.weekday() < 5 and start <= local_now.time() <= end
    if in_session:
        return {
            "fresh": age <= max_age,
            "status": "live" if age <= max_age else "stale",
            "delay_seconds": age,
        }
    recent_close = age <= 72 * 3600
    return {
        "fresh": recent_close,
        "status": "recent_close" if recent_close else "stale",
        "delay_seconds": None,
    }


def eastmoney_secid(symbol, market, yahoo_symbol):
    if market == "A":
        return f"{'1' if yahoo_symbol.endswith('.SS') else '0'}.{symbol}"
    if market == "HK":
        return f"116.{symbol.zfill(5)}"
    nyse = {"BRK.B", "JPM", "V", "UNH", "XOM", "HD", "KO"}
    return f"{'106' if symbol in nyse else '105'}.{symbol}"


def fetch_eastmoney_quotes(stocks):
    fields = ",".join(
        ["f43", "f47", "f57", "f58", "f59", "f116", "f162", "f167", "f170", "f124"]
    )
    secids = [eastmoney_secid(symbol, market, yahoo) for symbol, market, yahoo in stocks]
    rows = []
    for index in range(0, len(secids), 20):
        batch = secids[index : index + 20]
        url = (
            "https://push2.eastmoney.com/api/qt/ulist.np/get?"
            + urllib.parse.urlencode(
                {
                    "secids": ",".join(batch),
                    "fields": fields,
                    "fltt": 2,
                    "invt": 2,
                }
            )
        )
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": YAHOO_UA,
                "Accept": "application/json,text/plain,*/*",
                "Referer": "https://quote.eastmoney.com/",
            },
        )
        with urllib.request.urlopen(request, timeout=12) as response:
            payload = json.loads(response.read().decode("utf-8"))
        diff = (payload.get("data") or {}).get("diff") or []
        rows.extend(diff.values() if isinstance(diff, dict) else diff)
    by_code = {str(item.get("f57", "")).upper().lstrip("0"): item for item in rows}
    result = {}
    for symbol, market, _ in stocks:
        key = symbol.upper().lstrip("0") or "0"
        item = by_code.get(key)
        if item:
            result[(market, symbol)] = item
    return result


def quote_from_eastmoney_item(symbol, market, yahoo_symbol, item):
    timestamp = item.get("f124")
    return {
        "symbol": symbol,
        "market": market,
        "yahoo_symbol": yahoo_symbol,
        "price": clean_market_value(item.get("f43")),
        "change_pct": clean_market_value(item.get("f170")),
        "volume": clean_market_value(item.get("f47")),
        "market_cap": clean_market_value(item.get("f116")),
        "pe": clean_market_value(item.get("f162")),
        "pb": clean_market_value(item.get("f167")),
        "ps": None,
        "dividend_yield": None,
        "week_52_low": None,
        "week_52_high": None,
        "earnings_date": None,
        "ex_dividend_date": None,
        "as_of": as_of(timestamp),
        "market_timestamp": timestamp,
        "provider": quote_settings().get("provider_name", "东方财富"),
        "source_url": "https://quote.eastmoney.com/",
        "note": quote_settings().get("note", ""),
    }


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


def get_data_health():
    payload = get_quotes()
    quotes = payload.get("quotes", [])
    now = time.time()
    max_age = int(quote_settings().get("max_age_seconds", 1800))
    markets = {}
    for market in ("A", "HK", "US"):
        rows = [row for row in quotes if row.get("market") == market]
        timestamps = [row.get("market_timestamp") for row in rows if row.get("market_timestamp")]
        newest = max(timestamps) if timestamps else None
        age = max(0, int(now - newest)) if newest else None
        freshness = market_freshness(market, newest, now=now, max_age=max_age)
        markets[market] = {
            "count": len(rows),
            "latest_market_time": format_market_time(newest, market),
            "age_seconds": age,
            **freshness,
        }
    financial_probes = {
        "A": get_financials("600519", "A"),
        "HK": get_financials("0700", "HK"),
        "US": get_financials("AAPL", "US"),
    }
    financial_health = {
        market: {
            "ok": financial_result_is_usable(result),
            "rows": len(result.get("financials", [])),
            "provider": result.get("provider"),
            "source_url": result.get("source_url"),
            "error": result.get("error"),
        }
        for market, result in financial_probes.items()
    }
    healthy = all(item["count"] > 0 and item["fresh"] for item in markets.values()) and bool(
        all(item["ok"] for item in financial_health.values())
    )
    return {
        "status": "ok" if healthy else "degraded",
        "quote_provider": payload.get("provider"),
        "quote_error": payload.get("error"),
        "markets": markets,
        "financials": financial_health,
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


def get_sec_financials(symbol):
    if not sec_settings().get("enabled", True):
        return {"symbol": symbol, "financials": [], "error": "SEC 数据源已在配置中关闭"}
    if symbol not in SEC_CIK:
        return {"symbol": symbol, "financials": [], "error": "No CIK mapping"}
    cached = SEC_CACHE.get(symbol)
    now = time.time()
    if cached and cached["expires"] > now:
        return cached["payload"]

    url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{SEC_CIK[symbol]}.json"
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
        stock = next((row for row in STOCKS if row[0] == symbol and row[1] == "A"), None)
        suffix = "SH" if stock and stock[2].endswith(".SS") else "SZ"
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


def first_number(row, names):
    for name in names:
        value = row.get(name)
        if value not in (None, "", "-"):
            try:
                return float(value)
            except (TypeError, ValueError):
                continue
    return None


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
    if symbol not in SEC_CIK:
        return {"symbol": symbol, "filings": [], "error": "No CIK mapping"}
    cached = FILINGS_CACHE.get(symbol)
    now = time.time()
    if cached and cached["expires"] > now:
        return cached["payload"]

    cik = SEC_CIK[symbol]
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


def timestamp_to_date(value):
    if not value:
        return None
    try:
        return time.strftime("%Y-%m-%d", time.localtime(int(value)))
    except (TypeError, ValueError, OSError):
        return None


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


load_config()


if __name__ == "__main__":
    port = int(CONFIG.get("server", {}).get("port", 5174))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.allow_reuse_address = True
    print(f"StockAgent running at http://localhost:{port}")
    server.serve_forever()

"""External market-data adapters used by ETF analysis."""

import datetime
import re
import time
import urllib.parse

from .defaults import YAHOO_UA
from .http_client import http_get_json, http_get_text
from .dividend_registry import _normalize_etf_symbol

def _browser_headers(referer):
    return {
        "User-Agent": YAHOO_UA,
        "Accept": "application/json,text/plain,*/*",
        "Referer": referer,
    }

def fetch_csindex_history(index_code, start_date="20140101"):
    """中证指数官网日行情（含每日静态 PE）。升序返回。"""
    end_date = datetime.date.today().strftime("%Y%m%d")
    url = (
        "https://www.csindex.com.cn/csindex-home/perf/index-perf?"
        + urllib.parse.urlencode({"indexCode": index_code, "startDate": start_date, "endDate": end_date})
    )
    payload = http_get_json(url, headers=_browser_headers("https://www.csindex.com.cn/"), timeout=30)
    rows = payload.get("data") or []
    if not rows:
        raise RuntimeError(f"中证指数官网未返回 {index_code} 历史数据")
    history = []
    for row in rows:
        trade_date = str(row.get("tradeDate") or "")
        close = row.get("close")
        if len(trade_date) != 8 or close is None:
            continue
        history.append(
            {
                "date": f"{trade_date[:4]}-{trade_date[4:6]}-{trade_date[6:]}",
                "close": float(close),
                "high": float(row.get("high") or close),
                "low": float(row.get("low") or close),
                "change_pct": float(row["changePct"]) if row.get("changePct") is not None else None,
                "pe": float(row["peg"]) if row.get("peg") else None,
            }
        )
    history.sort(key=lambda item: item["date"])
    return history

def _market_prefixed_index(index_code):
    code = str(index_code or "").strip()
    prefix = "sz" if code.startswith("399") else "sh"
    return f"{prefix}{code}"

def fetch_sina_index_history(index_code, start_date="20140101", market_symbol=None):
    """新浪财经指数日 K（覆盖深证指数如创业板 399006）。无每日 PE。"""
    try:
        start = datetime.datetime.strptime(start_date, "%Y%m%d").date()
    except ValueError:
        start = datetime.date(2014, 1, 1)
    symbol = str(market_symbol or _market_prefixed_index(index_code)).strip()
    url = (
        "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?"
        + urllib.parse.urlencode({"symbol": symbol, "scale": "240", "ma": "no", "datalen": "5000"})
    )
    payload = http_get_json(url, headers=_browser_headers("https://finance.sina.com.cn/"), timeout=30)
    if not isinstance(payload, list) or not payload:
        raise RuntimeError(f"新浪未返回 {index_code} 历史数据")
    history = []
    previous_close = None
    for item in payload:
        if not isinstance(item, dict):
            continue
        date = str(item.get("day") or "")[:10]
        try:
            close = float(item.get("close"))
            high = float(item.get("high") or close)
            low = float(item.get("low") or close)
        except (TypeError, ValueError):
            continue
        if len(date) != 10 or date < start.isoformat():
            previous_close = close
            continue
        change_pct = None
        if previous_close:
            change_pct = (close / previous_close - 1) * 100
        history.append(
            {
                "date": date,
                "close": close,
                "high": high,
                "low": low,
                "change_pct": round(change_pct, 2) if change_pct is not None else None,
                "pe": None,
            }
        )
        previous_close = close
    if not history:
        raise RuntimeError(f"新浪未返回 {index_code} 可用历史数据")
    return history

def fetch_tencent_index_history(index_code, start_date="20140101", limit=2000, market_symbol=None):
    """腾讯财经指数日 K（含港股 / 美股指数）。无每日 PE。"""
    try:
        start = datetime.datetime.strptime(start_date, "%Y%m%d").date()
    except ValueError:
        start = datetime.date(2014, 1, 1)
    symbol = str(market_symbol or _market_prefixed_index(index_code)).strip()
    url = (
        "https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get?"
        + urllib.parse.urlencode({"param": f"{symbol},day,,,{int(limit)},qfq"})
    )
    payload = http_get_json(url, headers=_browser_headers("https://finance.qq.com/"), timeout=30)
    node = (payload.get("data") or {}).get(symbol) or {}
    # 指数返回 "day"；个股 / ETF 的前复权请求返回 "qfqday"
    day_rows = node.get("qfqday") or node.get("day") or []
    if not day_rows:
        raise RuntimeError(f"腾讯未返回 {index_code} 历史数据")
    history = []
    for row in day_rows:
        if not isinstance(row, (list, tuple)) or len(row) < 5:
            continue
        date = str(row[0])[:10]
        try:
            # 腾讯：日期, 开, 收, 高, 低, 量
            close = float(row[2])
            high = float(row[3])
            low = float(row[4])
            change_pct = float(row[7]) if len(row) > 7 and row[7] not in ("", None, {}) else None
        except (TypeError, ValueError):
            continue
        if len(date) != 10 or date < start.isoformat():
            continue
        history.append(
            {
                "date": date,
                "close": close,
                "high": high,
                "low": low,
                "change_pct": change_pct,
                "pe": None,
            }
        )
    if not history:
        raise RuntimeError(f"腾讯未返回 {index_code} 可用历史数据")
    return history

def fetch_etf_as_index_history(symbol, start_date="20140101"):
    """用 ETF 自身日 K 充当指数序列（入池兜底分析）。"""
    code = _normalize_etf_symbol(symbol)
    if not code:
        raise RuntimeError("无效 ETF 代码")
    market_symbol = ("sh" if code.startswith(("5", "6", "9")) else "sz") + code
    errors = []
    try:
        return fetch_tencent_index_history(code, start_date=start_date, limit=2000, market_symbol=market_symbol), "腾讯行情"
    except Exception as exc:
        errors.append(f"tencent: {exc}")
    try:
        return fetch_sina_index_history(code, start_date=start_date, market_symbol=market_symbol), "新浪财经"
    except Exception as exc:
        errors.append(f"sina: {exc}")
    raise RuntimeError("；".join(errors) or f"无法获取 {code} ETF 历史行情")

def fetch_index_history(index_code, start_date="20140101", preferred_source=None, market_symbol=None):
    """按指数来源取日线：中证官网优先；深证/海外走新浪或腾讯（无每日 PE）。

    返回 (rows, source_name)。
    """
    code = str(index_code or "").strip()
    preferred = (preferred_source or "").strip().lower()
    market_symbol = str(market_symbol or "").strip() or None
    if preferred == "etf":
        return fetch_etf_as_index_history(code, start_date=start_date)
    # eastmoney 别名保留：该源近期对指数 K 线不稳定，映射到新浪
    if preferred in ("eastmoney", "sina", "market"):
        order = ["sina", "tencent", "csindex"]
    elif preferred == "tencent":
        order = ["tencent", "sina", "csindex"]
    elif preferred == "csindex":
        order = ["csindex", "sina", "tencent"]
    elif market_symbol or code.upper() in ("HSTECH", "SPX", "NDX", "SP500"):
        order = ["tencent", "sina", "csindex"]
    elif code.startswith("399"):
        order = ["sina", "tencent", "csindex"]
    else:
        order = ["csindex", "sina", "tencent"]

    source_labels = {
        "csindex": "中证指数官网",
        "sina": "新浪财经",
        "tencent": "腾讯行情",
    }

    errors = []
    for source in order:
        try:
            if source == "csindex":
                return fetch_csindex_history(code, start_date=start_date), source_labels[source]
            if source == "sina":
                return fetch_sina_index_history(code, start_date=start_date), source_labels[source]
            return fetch_tencent_index_history(code, start_date=start_date, market_symbol=market_symbol), source_labels[source]
        except Exception as exc:
            errors.append(f"{source}: {exc}")
    raise RuntimeError("；".join(errors) or f"无法获取 {code} 历史数据")

def fill_missing_pe(index_rows, pe):
    """非中证源日线无 PE 时，按「盈利恒定」假设用当前 PE 随价格回推填充。

    pe_t ≈ pe_now × close_t / close_now（恒定 PE 填充会让股债利差历史只随国债
    变动，几乎失真；价格回推能保留估值波动，历史分位与回测才有意义）。
    """
    if pe is None or not index_rows:
        return index_rows
    anchor_close = None
    for row in reversed(index_rows):
        if row.get("close"):
            anchor_close = float(row["close"])
            break
    if not anchor_close:
        return index_rows
    for row in index_rows:
        if row.get("pe") is None and row.get("close"):
            row["pe"] = round(float(pe) * float(row["close"]) / anchor_close, 4)
    return index_rows

def fetch_danjuan_valuation(danjuan_code):
    """蛋卷基金指数估值：PE / PB / 股息率 / 近 10 年 PE 分位。"""
    url = f"https://danjuanfunds.com/djapi/index_eva/detail/{urllib.parse.quote(danjuan_code)}"
    payload = http_get_json(url, headers=_browser_headers("https://danjuanfunds.com/"), timeout=20)
    data = payload.get("data") or {}
    if not data.get("pe"):
        raise RuntimeError(f"蛋卷未返回 {danjuan_code} 估值")
    ts = data.get("ts")
    return {
        "pe": float(data["pe"]),
        "pb": float(data["pb"]) if data.get("pb") else None,
        "pe_percentile": float(data["pe_percentile"]) if data.get("pe_percentile") is not None else None,
        "pb_percentile": float(data["pb_percentile"]) if data.get("pb_percentile") is not None else None,
        "dividend_yield": float(data["yeild"]) if data.get("yeild") else None,
        "roe": float(data["roe"]) if data.get("roe") else None,
        "date": time.strftime("%Y-%m-%d", time.localtime(ts / 1000)) if ts else None,
        "source": "蛋卷基金",
        "source_url": "https://danjuanfunds.com/dj-valuation-table-detail",
    }

def fetch_treasury_yield_history(pages=6, page_size=500):
    """东方财富数据中心：中国 10 年期国债收益率（EMM00166466），升序返回。"""
    rows = []
    for page in range(1, pages + 1):
        url = (
            "https://datacenter-web.eastmoney.com/api/data/v1/get?"
            + urllib.parse.urlencode(
                {
                    "reportName": "RPTA_WEB_TREASURYYIELD",
                    "columns": "SOLAR_DATE,EMM00166466",
                    "pageSize": str(page_size),
                    "pageNumber": str(page),
                    "sortColumns": "SOLAR_DATE",
                    "sortTypes": "-1",
                    "client": "WEB",
                }
            )
        )
        payload = http_get_json(url, headers=_browser_headers("https://data.eastmoney.com/"), timeout=25)
        data = ((payload.get("result") or {}).get("data")) or []
        if not data:
            break
        for item in data:
            value = item.get("EMM00166466")
            date_raw = str(item.get("SOLAR_DATE") or "")[:10]
            if value is None or len(date_raw) != 10:
                continue
            rows.append({"date": date_raw, "yield10y": float(value)})
        if len(data) < page_size:
            break
    if not rows:
        raise RuntimeError("东方财富未返回国债收益率数据")
    rows.sort(key=lambda item: item["date"])
    return rows

def fetch_etf_quote(symbol):
    """跟踪 ETF 实时价（腾讯行情）。沪市 ETF 以 5 开头，深市以 1 开头。"""
    from .quotes import fetch_tencent_quotes, quote_from_tencent_item
    from .symbols import field_at

    symbol = str(symbol).strip()
    suffix = ".SS" if symbol.startswith(("5", "6", "9")) else ".SZ"
    stocks = [(symbol, "A", f"{symbol}{suffix}")]
    by_tencent = fetch_tencent_quotes(stocks)
    item = by_tencent.get(("A", symbol))
    if not item:
        raise RuntimeError(f"腾讯未返回 {symbol} 行情")
    quote = quote_from_tencent_item(symbol, "A", f"{symbol}{suffix}", item)
    quote["name"] = field_at(item, 1) or symbol
    return quote


def fetch_eastmoney_fund_profile(symbol):
    """基金档案中的规模与年度固定费率。"""
    symbol = _normalize_etf_symbol(symbol)
    if not symbol:
        raise ValueError("ETF 代码无效")
    url = f"https://fundf10.eastmoney.com/jbgk_{symbol}.html"
    html = http_get_text(
        url,
        headers=_browser_headers("https://fundf10.eastmoney.com/"),
        timeout=20,
        encoding="utf-8",
    )

    def number_after(label):
        match = re.search(rf"{label}</th><td[^>]*>\s*([0-9.]+)%", html)
        return float(match.group(1)) if match else None

    size_match = re.search(
        r"净资产规模</th><td[^>]*>\s*([0-9.]+)亿元（截止至：([^）]+)）",
        html,
    )
    management_fee = number_after("管理费率")
    custody_fee = number_after("托管费率")
    service_fee = number_after("销售服务费率")
    fees = [value for value in (management_fee, custody_fee, service_fee) if value is not None]
    if not size_match and not fees:
        raise RuntimeError(f"东方财富基金档案未返回 {symbol} 的规模或费率")
    return {
        "fund_size_yi": float(size_match.group(1)) if size_match else None,
        "fund_size_date": size_match.group(2) if size_match else None,
        "annual_fee_pct": round(sum(fees), 4) if fees else None,
        "management_fee_pct": management_fee,
        "custody_fee_pct": custody_fee,
        "service_fee_pct": service_fee,
        "provider": "东方财富基金档案",
        "source_url": url,
    }

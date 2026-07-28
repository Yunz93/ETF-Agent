"""Orchestration and caching for the ETF analysis endpoint."""

import time

from .dividend_analysis import analyze_dividend_data
from .dividend_registry import (
    _normalize_etf_symbol,
    proxy_valuation_note,
    resolve_analysis_settings,
    unsupported_analysis_payload,
)
from .dividend_sources import (
    fetch_danjuan_valuation,
    fetch_etf_as_index_history,
    fetch_etf_quote,
    fetch_index_history,
    fetch_treasury_yield_history,
    fill_missing_pe,
)
from .symbols import as_of

DIVIDEND_CACHE = {}

def clear_dividend_cache():
    DIVIDEND_CACHE.clear()

def missing_danjuan_note(has_daily_pe):
    """蛋卷未收录该指数（如中证A500）时的降级说明。"""
    if has_daily_pe:
        return (
            "蛋卷暂未收录该指数：PE 采用指数源每日序列并自算近 10 年分位；"
            "股息率缺失，股债利差与 PB 暂缺"
        )
    return "蛋卷暂未收录该指数，且指数源无每日 PE：估值与股债利差暂缺，本页以行情技术面为主"

def get_dividend_dashboard(refresh=False, symbol=None):
    """日度决策仪表盘。

    symbol 为空时走全局 dividend 设置。
    传入 ETF 代码时：注册表/名称推断走完整指数分析；否则用 ETF 行情兜底。
    """
    requested = _normalize_etf_symbol(symbol) if symbol else ""
    if symbol and not requested:
        return unsupported_analysis_payload(str(symbol or ""))

    # 先拿行情名称，便于名称推断（如「黄金ETF」）
    etf_quote = None
    etf_name = ""
    if requested:
        try:
            etf_quote = fetch_etf_quote(requested)
            etf_name = etf_quote.get("name") or ""
        except Exception:
            etf_quote = None

    settings = resolve_analysis_settings(requested or None, name=etf_name)
    if settings is None:
        return unsupported_analysis_payload(requested)

    if etf_name and not settings.get("etf_name"):
        settings["etf_name"] = etf_name
    if etf_quote is not None:
        etf_quote["symbol_name"] = settings.get("etf_name") or etf_quote.get("name") or requested

    cache_key = settings.get("etf_symbol") or settings.get("index_code") or "default"
    now = time.time()
    cached = DIVIDEND_CACHE.get(cache_key)
    if not refresh and cached and cached.get("payload") and cached.get("expires", 0) > now:
        return cached["payload"]

    errors = {}
    proxy = settings.get("analysis_mode") == "etf_proxy"
    index_source = "腾讯行情"
    try:
        if proxy:
            index_rows, index_source = fetch_etf_as_index_history(settings.get("etf_symbol") or requested)
        else:
            index_rows, index_source = fetch_index_history(
                settings.get("index_code", "H30269"),
                preferred_source=settings.get("history_source"),
                market_symbol=settings.get("history_symbol"),
            )
    except Exception as exc:
        return {
            "supported": True,
            "error": f"{'ETF' if proxy else '指数'}历史数据获取失败：{exc}",
            "name": settings.get("index_name") or settings.get("etf_name") or "ETF",
            "symbol": settings.get("etf_symbol"),
            "analysis_mode": settings.get("analysis_mode") or "index",
            "updated_at": as_of(None),
        }

    valuation = None
    danjuan_code = str(settings.get("danjuan_code") or "").strip()
    if danjuan_code:
        try:
            valuation = fetch_danjuan_valuation(danjuan_code)
        except Exception as exc:
            errors["valuation"] = f"蛋卷估值不可用，改用指数源 PE：{exc}"
    elif proxy:
        errors["valuation"] = proxy_valuation_note(settings.get("etf_name") or etf_name)
    else:
        has_daily_pe = any(row.get("pe") is not None for row in index_rows[-30:])
        errors["valuation"] = missing_danjuan_note(has_daily_pe)

    if valuation and valuation.get("pe") is not None:
        fill_missing_pe(index_rows, valuation.get("pe"))

    treasury_rows = []
    try:
        treasury_rows = fetch_treasury_yield_history()
    except Exception as exc:
        errors["bond"] = f"国债收益率不可用：{exc}"

    if etf_quote is None:
        try:
            etf_quote = fetch_etf_quote(settings.get("etf_symbol", "512890"))
            etf_quote["symbol_name"] = settings.get("etf_name") or etf_quote.get("name") or settings.get("etf_symbol")
        except Exception as exc:
            errors["etf"] = f"ETF 实时行情不可用：{exc}"

    payload = analyze_dividend_data(index_rows, valuation, treasury_rows, etf_quote, settings)
    payload["supported"] = True
    payload["symbol"] = settings.get("etf_symbol")
    payload["analysis_mode"] = settings.get("analysis_mode") or "index"
    if payload.get("index"):
        payload["index"]["source"] = index_source
        if proxy:
            payload["index"]["source_url"] = "https://gu.qq.com/"
            payload["index"]["note"] = "未收录指数映射，使用 ETF 自身行情近似"
        elif index_source != "中证指数官网":
            payload["index"]["source_url"] = (
                "https://finance.sina.com.cn/" if index_source == "新浪财经" else "https://finance.qq.com/"
            )
            if "valuation" not in errors:
                errors["index_pe"] = (
                    f"该指数日线来自{index_source}，无每日 PE；"
                    "历史 PE 按当前估值随价格回推（盈利恒定近似），利差分位与回测仅供参考"
                )
    if errors:
        payload["errors"] = errors
    index_source_url = {
        "中证指数官网": "https://www.csindex.com.cn/",
        "新浪财经": "https://finance.sina.com.cn/",
        "腾讯行情": "https://gu.qq.com/",
    }.get(index_source, "https://gu.qq.com/")
    payload["sources"] = [
        {
            "name": index_source,
            "url": index_source_url,
            "role": "ETF 日线（兜底分析）" if proxy else ("指数日线与每日 PE" if index_source == "中证指数官网" else "指数日线（无每日 PE）"),
        },
        {"name": "蛋卷基金", "url": "https://danjuanfunds.com/dj-valuation-table-detail", "role": "PE/PB/股息率与近10年PE分位"},
        {"name": "东方财富数据中心", "url": "https://data.eastmoney.com/cjsj/zmgzsyl.html", "role": "中国十年期国债收益率"},
        {"name": "腾讯行情", "url": "https://gu.qq.com/", "role": "跟踪 ETF 实时价"},
    ]

    ttl = int(settings.get("cache_seconds", 1800))
    DIVIDEND_CACHE[cache_key] = {"payload": payload, "expires": now + ttl}
    return payload

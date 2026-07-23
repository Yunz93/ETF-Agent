#!/usr/bin/env python3
"""Static defaults and provider constants for the index-ETF workbench."""

DEFAULT_ETF_POOL = [
    {"symbol": "512890", "name": "红利低波ETF"},
    {"symbol": "510300", "name": "沪深300ETF"},
    {"symbol": "510500", "name": "中证500ETF"},
    {"symbol": "159915", "name": "创业板ETF"},
    {"symbol": "513100", "name": "纳指ETF"},
    {"symbol": "518880", "name": "黄金ETF"},
]

DEFAULT_WORKSPACE = {
    "version": 2,
    "updated_at": None,
    "etfs": [],
    "prefs": {},
}

DEFAULT_CONFIG = {
    "server": {"port": 5174},
    "quotes": {
        "provider": "tencent",
        "provider_name": "腾讯行情",
        "note": "腾讯公开行情；缺失补齐与整批失败时东方财富兜底",
        "batch_size": 80,
        "max_age_seconds": 1800,
    },
    "etf": {
        "pool": DEFAULT_ETF_POOL,
        "note": "ETF 池默认种子；实际自选与持仓保存在 workspace.json",
    },
    "dividend": {
        "index_code": "H30269",
        "index_name": "红利低波",
        "index_full_name": "中证红利低波",
        "danjuan_code": "CSIH30269",
        "etf_symbol": "512890",
        "etf_name": "红利低波ETF",
        "cache_seconds": 1800,
        "note": "红利低波日度决策：中证指数官网 + 蛋卷估值 + 东方财富国债收益率",
    },
    "sources": {
        "QUOTE": [
            {
                "name": "腾讯行情",
                "url": "https://gu.qq.com/",
                "role": "ETF 实时/延迟行情",
            }
        ],
    },
}

YAHOO_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

# Eastmoney US ulist needs the NYSE prefix for these tickers (kept for HK/US quote parity).
EASTMONEY_NYSE = {
    "JPM", "V", "UNH", "XOM", "HD", "KO", "WMT", "PG", "JNJ", "MA", "DIS", "BA",
    "CAT", "IBM", "GS", "AXP", "MMM", "CVX", "MRK", "NKE", "TRV", "DOW", "CRM",
}

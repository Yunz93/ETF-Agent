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

# 完整估值分析需要指数日线 +（尽量）蛋卷估值；未收录 ETF 使用自身行情做技术面分析。
ETF_ANALYSIS_REGISTRY = {
    "512890": {
        "index_code": "H30269",
        "index_name": "红利低波",
        "index_full_name": "中证红利低波",
        "danjuan_code": "CSIH30269",
        "etf_name": "红利低波ETF",
    },
    "563020": {
        "index_code": "H30269",
        "index_name": "红利低波",
        "index_full_name": "中证红利低波",
        "danjuan_code": "CSIH30269",
        "etf_name": "红利低波ETF易方达",
    },
    "510300": {
        "index_code": "000300",
        "index_name": "沪深300",
        "index_full_name": "沪深300",
        "danjuan_code": "CSI000300",
        "etf_name": "沪深300ETF",
    },
    "510500": {
        "index_code": "000905",
        "index_name": "中证500",
        "index_full_name": "中证500",
        "danjuan_code": "CSI000905",
        "etf_name": "中证500ETF",
    },
    "159915": {
        "index_code": "399006",
        "index_name": "创业板指",
        "index_full_name": "创业板指数",
        "danjuan_code": "SZ399006",
        "etf_name": "创业板ETF",
        "history_source": "sina",
    },
    "563360": {
        "index_code": "000510",
        "index_name": "中证A500",
        "index_full_name": "中证A500",
        "danjuan_code": "",
        "etf_name": "A500ETF华泰柏瑞",
        "history_source": "csindex",
    },
    "510050": {
        "index_code": "000016",
        "index_name": "上证50",
        "index_full_name": "上证50",
        "danjuan_code": "CSI000016",
        "etf_name": "上证50ETF",
    },
    "159919": {
        "index_code": "000300",
        "index_name": "沪深300",
        "index_full_name": "沪深300",
        "danjuan_code": "CSI000300",
        "etf_name": "沪深300ETF",
    },
    "512100": {
        "index_code": "000852",
        "index_name": "中证1000",
        "index_full_name": "中证1000",
        "danjuan_code": "CSI000852",
        "etf_name": "中证1000ETF",
    },
    "513010": {
        "index_code": "HSTECH",
        "index_name": "恒生科技",
        "index_full_name": "恒生科技指数",
        "danjuan_code": "HKHSTECH",
        "etf_name": "恒生科技ETF易方达",
        "history_source": "tencent",
        "history_symbol": "hkHSTECH",
    },
    "513500": {
        "index_code": "SPX",
        "index_name": "标普500",
        "index_full_name": "标普500",
        "danjuan_code": "SP500",
        "etf_name": "标普500ETF博时",
        "history_source": "tencent",
        "history_symbol": "us.INX",
    },
    "513100": {
        "index_code": "NDX",
        "index_name": "纳斯达克100",
        "index_full_name": "纳斯达克100",
        "danjuan_code": "NDX",
        "etf_name": "纳指ETF",
        "history_source": "tencent",
        "history_symbol": "us.NDX",
    },
}

ETF_ANALYSIS_FIELDS = (
    "index_code",
    "index_name",
    "index_full_name",
    "danjuan_code",
    "etf_name",
    "history_source",
    "history_symbol",
)

DEFAULT_STRATEGY_CONFIG = {
    "pe_bands": [
        {"max_pct": 20, "mult": 1.5, "label": "低估区"},
        {"max_pct": 40, "mult": 1.2, "label": "偏低区"},
        {"max_pct": 60, "mult": 1.0, "label": "正常区"},
        {"max_pct": 80, "mult": 0.5, "label": "偏高区"},
        {"max_pct": 100, "mult": 0, "label": "高估区"},
    ],
    "grade_mult": {"A": 1.5, "B": 1.2, "C": 1.0, "D": 0.5, "E": 0},
    "use_rebalance": True,
}

DEFAULT_WORKSPACE = {
    "version": 4,
    "updated_at": None,
    "etfs": [],
    "buys": [],
    "plan": {
        "name": "默认定投计划",
        "amount": 2000,
        "cadence": "monthly",
        "day": 1,
        "note": "",
        "strategy": "valuation",
        "strategy_config": DEFAULT_STRATEGY_CONFIG,
    },
    "prefs": {},
}

# 种子池目标仓位（合计 100），仅用于首次初始化
DEFAULT_TARGET_WEIGHTS = {
    "512890": 30,
    "510300": 25,
    "510500": 15,
    "159915": 15,
    "513100": 10,
    "518880": 5,
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
        "analysis": {},
        "note": "定投计划默认 ETF 种子；计划与持仓保存在 workspace.json。完整估值分析见内置 ETF_ANALYSIS_REGISTRY。",
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

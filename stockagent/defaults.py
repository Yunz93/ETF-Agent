#!/usr/bin/env python3
"""Static defaults and provider/index constants."""

DEFAULT_WORKSPACE = {
    "version": 1,
    "updated_at": None,
    "watchlist": {},
    "holdings": {},
    "notes": {},
    "alertHistory": [],
    "prefs": {
      "notify": False,
      "baseCurrency": "CNY",
      "compactMode": False,
      "coreOnlyWorkbench": False,
      "showWatchTargets": False,
    },
    "customSymbols": [],
}

DEFAULT_CONFIG = {
    "server": {"port": 5174},
    "quotes": {
        "provider": "tencent",
        "provider_name": "腾讯行情",
        "note": "腾讯公开行情（按市场映射 PE/PB/市值）；缺失补齐与整批失败时东方财富兜底",
        "batch_size": 80,
        "max_age_seconds": 1800,
    },
    "catalog": {
        "cache_seconds": 21600,
        "note": "按指数成分股动态加载：上证指数、深证综指、恒生指数、标普500",
    },
    "sec": {
        "enabled": True,
        "user_agent": "StockAgent/0.1 personal-local contact@example.com",
    },
    "ai": {
        "enabled": True,
        "provider": "deepseek",
        "provider_name": "DeepSeek",
        "base_url": "https://api.deepseek.com",
        "model": "deepseek-chat",
        "api_key": "",
        "temperature": 0.3,
        "max_tokens": 2800,
        "timeout_seconds": 90,
        "note": "支持 DeepSeek / OpenAI / Moonshot / 通义 / 智谱 / SiliconFlow / OpenRouter / Groq / Ollama 等 Token 服务；API Key 仅保存在本地 config.json",
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

AI_PROVIDER_PRESETS = {
    "deepseek": {
        "provider_name": "DeepSeek",
        "base_url": "https://api.deepseek.com",
        "model": "deepseek-chat",
        "models": ["deepseek-chat", "deepseek-reasoner"],
        "docs_url": "https://platform.deepseek.com/api_keys",
        "note": "官方 OpenAI 兼容接口，推荐默认",
        "needs_api_key": True,
    },
    "openai": {
        "provider_name": "OpenAI",
        "base_url": "https://api.openai.com",
        "model": "gpt-4o-mini",
        "models": ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "o4-mini"],
        "docs_url": "https://platform.openai.com/api-keys",
        "note": "官方 Chat Completions",
        "needs_api_key": True,
    },
    "moonshot": {
        "provider_name": "Moonshot / Kimi",
        "base_url": "https://api.moonshot.cn",
        "model": "moonshot-v1-auto",
        "models": ["moonshot-v1-auto", "moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k", "kimi-latest"],
        "docs_url": "https://platform.moonshot.cn/console/api-keys",
        "note": "月之暗面 Kimi，OpenAI 兼容",
        "needs_api_key": True,
    },
    "qwen": {
        "provider_name": "通义千问 / DashScope",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode",
        "model": "qwen-plus",
        "models": ["qwen-plus", "qwen-turbo", "qwen-max", "qwen-long"],
        "docs_url": "https://bailian.console.aliyun.com/",
        "note": "阿里云百炼兼容模式",
        "needs_api_key": True,
    },
    "zhipu": {
        "provider_name": "智谱 GLM",
        "base_url": "https://open.bigmodel.cn/api/paas",
        "model": "glm-4-flash",
        "models": ["glm-4-flash", "glm-4-air", "glm-4-plus", "glm-4.5-flash"],
        "docs_url": "https://open.bigmodel.cn/usercenter/apikeys",
        "note": "BigModel OpenAI 兼容（/v4）",
        "needs_api_key": True,
        "api_path": "/v4/chat/completions",
    },
    "siliconflow": {
        "provider_name": "SiliconFlow 硅基流动",
        "base_url": "https://api.siliconflow.cn",
        "model": "deepseek-ai/DeepSeek-V3",
        "models": [
            "deepseek-ai/DeepSeek-V3",
            "deepseek-ai/DeepSeek-R1",
            "Qwen/Qwen2.5-72B-Instruct",
            "THUDM/glm-4-9b-chat",
        ],
        "docs_url": "https://cloud.siliconflow.cn/account/ak",
        "note": "聚合多家开源模型的 Token 服务",
        "needs_api_key": True,
    },
    "openrouter": {
        "provider_name": "OpenRouter",
        "base_url": "https://openrouter.ai/api",
        "model": "deepseek/deepseek-chat",
        "models": [
            "deepseek/deepseek-chat",
            "deepseek/deepseek-r1",
            "openai/gpt-4o-mini",
            "google/gemini-2.0-flash-001",
            "anthropic/claude-3.5-sonnet",
        ],
        "docs_url": "https://openrouter.ai/keys",
        "note": "统一路由多家模型",
        "needs_api_key": True,
    },
    "groq": {
        "provider_name": "Groq",
        "base_url": "https://api.groq.com/openai",
        "model": "llama-3.3-70b-versatile",
        "models": ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-20b"],
        "docs_url": "https://console.groq.com/keys",
        "note": "高速推理，OpenAI 兼容",
        "needs_api_key": True,
    },
    "ollama": {
        "provider_name": "Ollama 本地",
        "base_url": "http://127.0.0.1:11434",
        "model": "llama3.1",
        "models": ["llama3.1", "qwen2.5", "deepseek-r1", "mistral"],
        "docs_url": "https://ollama.com/",
        "note": "本机 Ollama，通常无需 API Key",
        "needs_api_key": False,
    },
    "custom": {
        "provider_name": "自定义 OpenAI 兼容",
        "base_url": "",
        "model": "",
        "models": [],
        "docs_url": "",
        "note": "任意兼容 /v1/chat/completions 的 Token 服务",
        "needs_api_key": True,
    },
}

AI_STRATEGY_SYSTEM_PROMPT = """你是一名严谨的跨市场股票研究分析师，服务个人研究工作台 StockAgent。
你必须基于用户提供的结构化行情、估值、财报与历史价格数据进行分析，不得编造未给出的财报数字或公告事实。
若数据不足，明确写出“数据不足 / 无法判断”，并说明还缺什么。

分析框架（按顺序覆盖）：
1. 公司与市场定位：市场、行业、当前价与关键估值指标。
2. 历史走势研判：结合历史收盘价序列，判断趋势、波动、回撤、相对 52 周位置与关键支撑/压力观察位。
3. 基本面质量：收入/利润趋势、毛利率、ROE、现金流与负债；区分周期波动与结构性变化。
4. 估值与安全边际：对照给出的估值区间与规则评分，判断低估/合理/偏贵，并解释主要驱动。
5. 风险清单：经营、估值、流动性、事件与数据质量风险，按重要性排序。
6. 操作建议（研究口径，非投资建议）：在 观望 / 关注买入 / 持有 / 减仓 / 移出 中给出一个主建议；
   必须同时给出：建议关注价或区间、失效条件、仓位思路（轻/中/重或不宜建仓）、下次复盘触发点。

输出要求：
- 使用简体中文 Markdown。
- 结构清晰，小标题完整。
- 建议必须可回看、可证伪，避免空泛口号。
- 结尾固定一行：仅供研究参考，不构成投资建议。"""
INDEX_UNIVERSES = {
    "A": [
        {
            "code": "000001",
            "name": "上证指数",
            "source": "csindex",
            "csindex_code": "000001",
        },
        {
            "code": "399106",
            "name": "深证综指",
            "source": "sina",
            "sina_code": "399106",
        },
    ],
    "HK": [
        {
            "code": "HSI",
            "name": "恒生指数",
            "source": "yfiua",
            "yfiua_code": "hsi",
        },
    ],
    "US": [
        {
            "code": "SPX",
            "name": "标普500",
            "source": "yfiua",
            "yfiua_code": "sp500",
        },
    ],
}
YAHOO_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
GICS_SECTOR_ZH = {
    "Communication Services": "通信服务",
    "Consumer Discretionary": "可选消费",
    "Consumer Staples": "日常消费",
    "Energy": "能源",
    "Financials": "金融",
    "Health Care": "医疗保健",
    "Industrials": "工业",
    "Information Technology": "信息技术",
    "Materials": "原材料",
    "Real Estate": "房地产",
    "Utilities": "公用事业",
}
EASTMONEY_NYSE = {
    "JPM", "V", "UNH", "XOM", "HD", "KO", "WMT", "PG", "JNJ", "MA", "DIS", "BA",
    "CAT", "IBM", "GS", "AXP", "MMM", "CVX", "MRK", "NKE", "TRV", "DOW", "CRM",
}

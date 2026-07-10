#!/usr/bin/env python3
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

REPO_ROOT = Path(__file__).resolve().parent


def _resolve_resource_root():
    raw = os.environ.get("STOCKAGENT_RESOURCE_DIR")
    if raw:
        return Path(raw).expanduser().resolve()
    # PyInstaller onefile/onedir support
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS).resolve()
    return REPO_ROOT


def _resolve_data_dir():
    raw = os.environ.get("STOCKAGENT_DATA_DIR")
    if raw:
        path = Path(raw).expanduser().resolve()
    elif os.environ.get("STOCKAGENT_DESKTOP") == "1":
        if sys.platform == "darwin":
            path = Path.home() / "Library" / "Application Support" / "StockAgent"
        elif sys.platform == "win32":
            base = os.environ.get("APPDATA") or str(Path.home())
            path = Path(base) / "StockAgent"
        else:
            path = Path.home() / ".local" / "share" / "StockAgent"
    else:
        path = REPO_ROOT
    path.mkdir(parents=True, exist_ok=True)
    (path / "logs").mkdir(parents=True, exist_ok=True)
    return path


RESOURCE_ROOT = _resolve_resource_root()
DATA_DIR = _resolve_data_dir()
# Back-compat alias used by older helpers / docs.
ROOT = RESOURCE_ROOT
CONFIG_PATH = DATA_DIR / "config.json"
WORKSPACE_PATH = DATA_DIR / "workspace.json"
WORKSPACE_LOCK = threading.Lock()

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
        "note": "腾讯公开行情接口，东方财富自动兜底",
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

CONFIG = json.loads(json.dumps(DEFAULT_CONFIG))

# Index universes: full constituents, refreshed periodically.
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

CATALOG_CACHE = {"expires": 0, "payload": None, "by_key": {}, "stocks": []}
CATALOG_DISK_CACHE = DATA_DIR / ".catalog-cache.json"
SEC_CIK_CACHE = {"expires": 0, "payload": {}}
QUOTE_MARKET_CACHE = {}

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
        target = (RESOURCE_ROOT / path.lstrip("/")).resolve()
        if not str(target).startswith(str(RESOURCE_ROOT)) or not target.exists() or target.is_dir():
            self.send_error(404)
            return
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(target.stat().st_size))
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        if parsed.path == "/api/config":
            self.send_json(public_config())
            return
        if parsed.path == "/api/ai/providers":
            self.send_json(list_ai_providers())
            return
        if parsed.path == "/api/catalog":
            market = query.get("market", [""])[0].upper()
            index = query.get("index", [""])[0].strip().upper()
            self.send_json(get_catalog(market or None, index or None))
            return
        if parsed.path == "/api/quotes":
            market = query.get("market", [""])[0].upper()
            index = query.get("index", [""])[0].strip().upper()
            limit_raw = query.get("limit", [""])[0].strip()
            offset_raw = query.get("offset", ["0"])[0].strip() or "0"
            limit = int(limit_raw) if limit_raw.isdigit() else None
            offset = int(offset_raw) if offset_raw.isdigit() else 0
            self.send_json(get_quotes(market or None, index or None, limit=limit, offset=offset))
            return
        if parsed.path == "/api/health":
            self.send_json(get_data_health())
            return
        if parsed.path == "/api/ready":
            # Lightweight liveness for desktop launch — must not touch markets.
            self.send_json(
                {
                    "ready": True,
                    "app": "StockAgent",
                    "mode": "desktop" if os.environ.get("STOCKAGENT_DESKTOP") == "1" else "server",
                    "frozen": bool(getattr(sys, "frozen", False)),
                }
            )
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
        if parsed.path == "/api/runtime":
            self.send_json(get_runtime_info())
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
                self.send_json(public_config(save_config(payload)))
                return
            if parsed.path == "/api/workspace":
                self.send_json(save_workspace(payload))
                return
            self.send_error(404)
        except Exception as exc:
            self.send_json({"error": str(exc)}, status=500)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(body.decode("utf-8") if body else "{}")
        except json.JSONDecodeError as exc:
            self.send_json({"error": f"JSON 格式错误: {exc}"}, status=400)
            return

        try:
            if parsed.path == "/api/ai/analyze":
                self.send_json(*analyze_stock_with_ai(payload))
                return
            if parsed.path == "/api/ai/test":
                self.send_json(*test_ai_connection(payload))
                return
            if parsed.path == "/api/config":
                self.send_json(public_config(save_config(payload)))
                return
            if parsed.path == "/api/workspace":
                self.send_json(save_workspace(payload))
                return
            self.send_error(404)
        except Exception as exc:
            self.send_json({"error": str(exc)}, status=500)

    def serve_static(self, path):
        if path == "/":
            path = "/index.html"
        target = (RESOURCE_ROOT / path.lstrip("/")).resolve()
        if not str(target).startswith(str(RESOURCE_ROOT)) or not target.exists() or target.is_dir():
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
        seed = RESOURCE_ROOT / "config.json"
        if seed.exists() and seed.resolve() != CONFIG_PATH.resolve():
            try:
                loaded = json.loads(seed.read_text(encoding="utf-8"))
                CONFIG = normalize_config(loaded)
            except Exception:
                CONFIG = json.loads(json.dumps(DEFAULT_CONFIG))
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
    if isinstance(payload.get("catalog"), dict):
        config["catalog"].update(payload["catalog"])
    if isinstance(payload.get("sec"), dict):
        config["sec"].update(payload["sec"])
    if isinstance(payload.get("ai"), dict):
        config["ai"].update(payload["ai"])
        config["ai"] = normalize_ai_config(config["ai"], payload.get("ai") or {})
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


def normalize_ai_config(merged, incoming):
    provider = str(merged.get("provider") or "deepseek").strip().lower() or "deepseek"
    if provider not in AI_PROVIDER_PRESETS:
        provider = "custom"
    preset = AI_PROVIDER_PRESETS[provider]
    api_key = str(merged.get("api_key") or "").strip()
    # Settings UI masks secrets as ******** / empty means "keep existing key".
    if isinstance(incoming, dict):
        raw_incoming = incoming.get("api_key")
        if raw_incoming is None or str(raw_incoming).strip() in ("", "********"):
            api_key = str((CONFIG.get("ai") or {}).get("api_key") or "").strip()
        else:
            api_key = str(raw_incoming).strip()
    if api_key == "********":
        api_key = str((CONFIG.get("ai") or {}).get("api_key") or "").strip()
    base_url = str(merged.get("base_url") or preset.get("base_url") or "").strip().rstrip("/")
    model = str(merged.get("model") or preset.get("model") or "").strip()
    provider_name = str(merged.get("provider_name") or preset.get("provider_name") or provider).strip()
    try:
        temperature = float(merged.get("temperature", 0.3))
    except (TypeError, ValueError):
        temperature = 0.3
    try:
        max_tokens = int(merged.get("max_tokens", 2800))
    except (TypeError, ValueError):
        max_tokens = 2800
    try:
        timeout_seconds = int(merged.get("timeout_seconds", 90))
    except (TypeError, ValueError):
        timeout_seconds = 90
    return {
        "enabled": bool(merged.get("enabled", True)),
        "provider": provider,
        "provider_name": provider_name or preset.get("provider_name") or provider,
        "base_url": base_url,
        "model": model,
        "api_key": api_key,
        "temperature": max(0.0, min(temperature, 2.0)),
        "max_tokens": max(256, min(max_tokens, 8192)),
        "timeout_seconds": max(15, min(timeout_seconds, 180)),
        "note": str(merged.get("note") or DEFAULT_CONFIG["ai"]["note"]).strip(),
    }


def public_config(config=None):
    payload = json.loads(json.dumps(config if config is not None else CONFIG))
    ai = payload.get("ai") or {}
    api_key = str(ai.get("api_key") or "").strip()
    ai["has_api_key"] = bool(api_key)
    ai["api_key"] = "********" if api_key else ""
    payload["ai"] = ai
    return payload


def ai_settings():
    return CONFIG.get("ai", DEFAULT_CONFIG["ai"])


def save_config(payload):
    global CONFIG
    CONFIG = normalize_config(payload)
    CONFIG_PATH.write_text(json.dumps(CONFIG, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    QUOTE_CACHE["expires"] = 0
    QUOTE_MARKET_CACHE.clear()
    CATALOG_CACHE["expires"] = 0
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


def catalog_settings():
    return CONFIG.get("catalog", DEFAULT_CONFIG.get("catalog", {}))


def http_get_bytes(url, headers=None, timeout=45):
    request = urllib.request.Request(
        url,
        headers=headers
        or {
            "User-Agent": YAHOO_UA,
            "Accept": "*/*",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def http_get_text(url, headers=None, timeout=45, encoding="utf-8"):
    return http_get_bytes(url, headers=headers, timeout=timeout).decode(encoding, errors="replace")


def http_get_json(url, headers=None, timeout=45):
    return json.loads(http_get_text(url, headers=headers, timeout=timeout))


def http_post_json(url, payload, headers=None, timeout=90):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request_headers = {
        "User-Agent": YAHOO_UA,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if headers:
        request_headers.update(headers)
    request = urllib.request.Request(url, data=data, headers=request_headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
            return response.getcode(), json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            detail = {"error": raw or str(exc)}
        return exc.code, detail


def chat_completions_url(base_url, provider=None, api_path=None):
    root = (base_url or "").strip().rstrip("/")
    if not root:
        return ""
    if root.endswith("/chat/completions"):
        return root
    preset = AI_PROVIDER_PRESETS.get(str(provider or "").strip().lower()) or {}
    path = (api_path or preset.get("api_path") or "").strip()
    if path:
        if not path.startswith("/"):
            path = f"/{path}"
        return f"{root}{path}"
    if root.endswith("/v1"):
        return f"{root}/chat/completions"
    return f"{root}/v1/chat/completions"


def list_ai_providers():
    items = []
    for key, preset in AI_PROVIDER_PRESETS.items():
        items.append(
            {
                "id": key,
                "provider_name": preset.get("provider_name") or key,
                "base_url": preset.get("base_url") or "",
                "model": preset.get("model") or "",
                "models": list(preset.get("models") or ([] if not preset.get("model") else [preset.get("model")])),
                "docs_url": preset.get("docs_url") or "",
                "note": preset.get("note") or "",
                "needs_api_key": bool(preset.get("needs_api_key", True)),
                "api_path": preset.get("api_path") or "",
            }
        )
    current = ai_settings()
    return {
        "providers": items,
        "current": {
            "provider": current.get("provider"),
            "provider_name": current.get("provider_name"),
            "base_url": current.get("base_url"),
            "model": current.get("model"),
            "has_api_key": bool(str(current.get("api_key") or "").strip() or os.environ.get("STOCKAGENT_AI_API_KEY")),
            "enabled": bool(current.get("enabled", True)),
        },
    }


def resolve_ai_runtime(overrides=None):
    settings = dict(ai_settings())
    overrides = overrides if isinstance(overrides, dict) else {}
    provider = str(overrides.get("provider") or settings.get("provider") or "deepseek").strip().lower() or "deepseek"
    if provider not in AI_PROVIDER_PRESETS:
        provider = "custom"
    preset = AI_PROVIDER_PRESETS[provider]
    base_url = str(overrides.get("base_url") or settings.get("base_url") or preset.get("base_url") or "").strip().rstrip("/")
    model = str(overrides.get("model") or settings.get("model") or preset.get("model") or "").strip()
    provider_name = str(
        overrides.get("provider_name") or settings.get("provider_name") or preset.get("provider_name") or provider
    ).strip()
    incoming_key = overrides.get("api_key")
    if incoming_key is None or str(incoming_key).strip() in ("", "********"):
        api_key = str(settings.get("api_key") or "").strip() or str(os.environ.get("STOCKAGENT_AI_API_KEY") or "").strip()
    else:
        api_key = str(incoming_key).strip()
    endpoint = chat_completions_url(base_url, provider=provider, api_path=preset.get("api_path"))
    return {
        "provider": provider,
        "provider_name": provider_name,
        "base_url": base_url,
        "model": model,
        "api_key": api_key,
        "endpoint": endpoint,
        "needs_api_key": bool(preset.get("needs_api_key", True)),
        "temperature": settings.get("temperature", 0.3),
        "max_tokens": settings.get("max_tokens", 2800),
        "timeout_seconds": int(settings.get("timeout_seconds") or 90),
        "enabled": bool(settings.get("enabled", True)),
    }


def test_ai_connection(payload=None):
    runtime = resolve_ai_runtime(payload if isinstance(payload, dict) else {})
    if not runtime["endpoint"] or not runtime["model"]:
        return {"error": "请先填写 Base URL 与模型名称"}, 400
    if runtime["needs_api_key"] and not runtime["api_key"]:
        return {
            "error": "尚未配置 API Key。请填写 Token 服务密钥，或设置环境变量 STOCKAGENT_AI_API_KEY。",
            "code": "missing_api_key",
            "provider": runtime["provider"],
        }, 400

    body = {
        "model": runtime["model"],
        "temperature": 0,
        "max_tokens": 32,
        "messages": [
            {
                "role": "user",
                "content": "Reply with exactly: STOCKAGENT_OK",
            }
        ],
    }
    headers = {}
    if runtime["api_key"]:
        headers["Authorization"] = f"Bearer {runtime['api_key']}"
    # OpenRouter recommends these optional headers.
    if runtime["provider"] == "openrouter":
        headers["HTTP-Referer"] = "https://github.com/Yunz93/StockAgent"
        headers["X-Title"] = "StockAgent"

    status, response = http_post_json(
        runtime["endpoint"],
        body,
        headers=headers or None,
        timeout=min(45, runtime["timeout_seconds"]),
    )
    if status >= 400:
        message = None
        if isinstance(response, dict):
            err = response.get("error")
            if isinstance(err, dict):
                message = err.get("message") or err.get("code")
            elif err:
                message = str(err)
            else:
                message = response.get("message")
        return {
            "ok": False,
            "error": message or f"模型接口返回 HTTP {status}",
            "provider_status": status,
            "provider": runtime["provider"],
            "provider_name": runtime["provider_name"],
            "model": runtime["model"],
            "endpoint": runtime["endpoint"],
        }, 502

    content = ""
    if isinstance(response, dict):
        choices = response.get("choices") or []
        if choices and isinstance(choices[0], dict):
            message = choices[0].get("message") or {}
            content = str(message.get("content") or choices[0].get("text") or "").strip()
    return {
        "ok": True,
        "message": "连接成功，模型接口可用",
        "provider": runtime["provider"],
        "provider_name": runtime["provider_name"],
        "model": runtime["model"],
        "endpoint": runtime["endpoint"],
        "sample": content[:120],
        "usage": response.get("usage") if isinstance(response, dict) else None,
    }, 200


def _fmt_num(value, digits=2, suffix=""):
    if value is None or value == "":
        return "—"
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value)
    text = f"{number:.{digits}f}".rstrip("0").rstrip(".")
    return f"{text}{suffix}"


def _history_snapshot(points):
    if not isinstance(points, list) or not points:
        return {"count": 0, "points": []}
    cleaned = []
    for item in points:
        if not isinstance(item, dict):
            continue
        date = str(item.get("date") or "").strip()
        close = item.get("close")
        if not date or close is None:
            continue
        try:
            cleaned.append({"date": date, "close": float(close)})
        except (TypeError, ValueError):
            continue
    if not cleaned:
        return {"count": 0, "points": []}
    first = cleaned[0]
    last = cleaned[-1]
    closes = [row["close"] for row in cleaned]
    peak = max(closes)
    trough = min(closes)
    change_pct = ((last["close"] / first["close"]) - 1.0) * 100.0 if first["close"] else None
    drawdown_pct = ((last["close"] / peak) - 1.0) * 100.0 if peak else None
    # Keep prompt size bounded: endpoints + evenly spaced samples.
    sample = cleaned
    if len(cleaned) > 36:
        step = max(1, len(cleaned) // 34)
        sample = cleaned[::step]
        if sample[-1] != cleaned[-1]:
            sample.append(cleaned[-1])
        sample = sample[:36]
    return {
        "count": len(cleaned),
        "start": first,
        "end": last,
        "high": {"close": peak},
        "low": {"close": trough},
        "change_pct": round(change_pct, 2) if change_pct is not None else None,
        "drawdown_from_high_pct": round(drawdown_pct, 2) if drawdown_pct is not None else None,
        "points": sample,
    }


def build_ai_user_prompt(payload):
    stock = payload.get("stock") if isinstance(payload.get("stock"), dict) else {}
    quote = stock.get("quote") if isinstance(stock.get("quote"), dict) else {}
    valuation = stock.get("valuation") if isinstance(stock.get("valuation"), dict) else {}
    analysis = stock.get("analysis") if isinstance(stock.get("analysis"), dict) else {}
    note = payload.get("note") if isinstance(payload.get("note"), dict) else {}
    holding = payload.get("holding") if isinstance(payload.get("holding"), dict) else None
    history = _history_snapshot(payload.get("history") or [])
    financials = stock.get("financials") if isinstance(stock.get("financials"), list) else []
    latest_financials = financials[-4:] if financials else []
    focus = str(payload.get("focus") or "").strip()
    range_key = str(payload.get("history_range") or "1y")

    lines = [
        "请基于以下 StockAgent 研究数据包，输出完整分析与操作建议。",
        "",
        "## 标的",
        f"- 名称：{stock.get('name') or '—'}",
        f"- 代码：{stock.get('symbol') or '—'}",
        f"- 市场：{stock.get('market') or '—'}",
        f"- 交易所：{stock.get('exchange') or '—'}",
        f"- 行业：{stock.get('industry') or '—'}",
        f"- 币种：{stock.get('currency') or '—'}",
        "",
        "## 行情",
        f"- 现价：{_fmt_num(quote.get('price'))}",
        f"- 涨跌幅：{_fmt_num(quote.get('change_pct'), 2, '%')}",
        f"- PE：{_fmt_num(quote.get('pe'), 2)}",
        f"- PB：{_fmt_num(quote.get('pb'), 2)}",
        f"- PS：{_fmt_num(quote.get('ps'), 2)}",
        f"- 股息率：{_fmt_num(quote.get('dividend_yield'), 2, '%')}",
        f"- 市值：{_fmt_num(quote.get('market_cap'), 0)}",
        f"- 52周低/高：{_fmt_num(quote.get('week_52_low'))} / {_fmt_num(quote.get('week_52_high'))}",
        f"- 行情时间：{quote.get('as_of') or '—'}",
        "",
        "## 规则估值（本地模型）",
        f"- 方法：{valuation.get('method') or '—'}",
        f"- 状态：{valuation.get('state') or '—'}",
        f"- 保守/基准/乐观：{_fmt_num(valuation.get('bear_price'))} / {_fmt_num(valuation.get('base_price'))} / {_fmt_num(valuation.get('bull_price'))}",
        f"- 关注区间：{valuation.get('watch_zone')}",
        f"- 合理区间：{valuation.get('fair_zone')}",
        f"- 偏贵区间：{valuation.get('expensive_zone')}",
        f"- 风险价：{_fmt_num(valuation.get('risk_price'))}",
        f"- 假设：{'; '.join(valuation.get('assumptions') or []) or '—'}",
        "",
        "## 规则评分摘要",
        f"- 评分：{analysis.get('score') if analysis.get('score') is not None else '—'}",
        f"- 评级：{analysis.get('rating_label') or '—'}",
        f"- 摘要：{analysis.get('summary') or '—'}",
        f"- 积极因素：{'; '.join(analysis.get('positives') or []) or '—'}",
        f"- 风险因素：{'; '.join(analysis.get('risks') or []) or '—'}",
        "",
        f"## 历史价格（区间 {range_key}）",
        f"- 样本数：{history.get('count', 0)}",
        f"- 起点：{history.get('start')}",
        f"- 终点：{history.get('end')}",
        f"- 区间涨跌：{_fmt_num(history.get('change_pct'), 2, '%')}",
        f"- 相对高点回撤：{_fmt_num(history.get('drawdown_from_high_pct'), 2, '%')}",
        f"- 采样点：{json.dumps(history.get('points') or [], ensure_ascii=False)}",
        "",
        "## 近期财报（最多 4 期）",
        json.dumps(latest_financials, ensure_ascii=False),
        "",
        "## 用户判断卡",
        f"- 投资论点：{note.get('thesis') or '（空）'}",
        f"- 失效条件：{note.get('invalidation') or '（空）'}",
        f"- 决策状态：{note.get('decision') or 'watch'}",
        f"- 关注价：{note.get('watchPrice') if note.get('watchPrice') is not None else '—'}",
        f"- 下次复盘：{note.get('reviewDate') or '—'}",
    ]
    if holding:
        lines.extend(
            [
                "",
                "## 当前持仓",
                f"- 数量：{holding.get('shares')}",
                f"- 成本：{holding.get('cost')}",
            ]
        )
    if focus:
        lines.extend(["", "## 用户额外关注点", focus])
    lines.extend(
        [
            "",
            "请按系统策略输出完整 Markdown 报告，并给出明确的研究建议（观望/关注买入/持有/减仓/移出）。",
        ]
    )
    return "\n".join(lines)


def analyze_stock_with_ai(payload):
    if not isinstance(payload, dict):
        return {"error": "请求体必须是 JSON 对象"}, 400

    runtime = resolve_ai_runtime()
    if not runtime.get("enabled", True):
        return {"error": "AI 分析已在设置中关闭"}, 400
    if not runtime["endpoint"] or not runtime["model"]:
        return {"error": "AI base_url 或 model 未配置完整"}, 400
    if runtime["needs_api_key"] and not runtime["api_key"]:
        return {
            "error": "尚未配置 AI API Key。请到设置页填写 DeepSeek / OpenAI 兼容密钥，或设置环境变量 STOCKAGENT_AI_API_KEY。",
            "code": "missing_api_key",
        }, 400

    stock = payload.get("stock") if isinstance(payload.get("stock"), dict) else {}
    if not stock.get("symbol") or not stock.get("market"):
        return {"error": "缺少 stock.symbol / stock.market"}, 400

    # Prefer server-side history so the model always sees a consistent series.
    history_range = str(payload.get("history_range") or "1y").strip().lower() or "1y"
    if history_range not in ("1m", "3m", "6m", "1y", "5y"):
        history_range = "1y"
    history_payload = get_price_history(str(stock.get("symbol")), str(stock.get("market")).upper(), history_range)
    history_points = history_payload.get("points") if isinstance(history_payload, dict) else []
    if not history_points and isinstance(payload.get("history"), list):
        history_points = payload.get("history")

    request_payload = {
        "stock": stock,
        "note": payload.get("note") if isinstance(payload.get("note"), dict) else {},
        "holding": payload.get("holding") if isinstance(payload.get("holding"), dict) else None,
        "focus": payload.get("focus"),
        "history": history_points,
        "history_range": history_range,
    }
    user_prompt = build_ai_user_prompt(request_payload)
    body = {
        "model": runtime["model"],
        "temperature": runtime.get("temperature", 0.3),
        "max_tokens": runtime.get("max_tokens", 2800),
        "messages": [
            {"role": "system", "content": AI_STRATEGY_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
    }
    headers = {}
    if runtime["api_key"]:
        headers["Authorization"] = f"Bearer {runtime['api_key']}"
    if runtime["provider"] == "openrouter":
        headers["HTTP-Referer"] = "https://github.com/Yunz93/StockAgent"
        headers["X-Title"] = "StockAgent"
    status, response = http_post_json(
        runtime["endpoint"],
        body,
        headers=headers or None,
        timeout=int(runtime.get("timeout_seconds") or 90),
    )
    if status >= 400:
        message = None
        if isinstance(response, dict):
            err = response.get("error")
            if isinstance(err, dict):
                message = err.get("message") or err.get("code")
            elif err:
                message = str(err)
            else:
                message = response.get("message")
        return {
            "error": message or f"模型接口返回 HTTP {status}",
            "provider_status": status,
            "provider": runtime["provider"],
            "model": runtime["model"],
        }, 502

    content = ""
    usage = None
    if isinstance(response, dict):
        usage = response.get("usage")
        choices = response.get("choices") or []
        if choices and isinstance(choices[0], dict):
            message = choices[0].get("message") or {}
            content = str(message.get("content") or "").strip()
            if not content:
                content = str(choices[0].get("text") or "").strip()
    if not content:
        return {"error": "模型未返回有效内容", "raw": response}, 502

    return {
        "ok": True,
        "content": content,
        "provider": runtime["provider"],
        "provider_name": runtime["provider_name"],
        "model": runtime["model"],
        "history_range": history_range,
        "history_points": len(history_points or []),
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "usage": usage,
        "disclaimer": "仅供研究参考，不构成投资建议。",
    }, 200


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


def industry_needs_enrichment(value):
    text = normalize_industry(value)
    return text in {"未分类", "恒生成分", "标普500", "自定义"}


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
        secids.append(eastmoney_secid(symbol, market, yahoo))
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
        for symbol, item_market, yahoo_symbol in stocks:
            item = by_tencent.get((item_market, symbol))
            if not item:
                continue
            quotes.append(quote_from_tencent_item(symbol, item_market, yahoo_symbol, item))
        response = {
            "quotes": quotes,
            "provider": quote_settings().get("provider_name", "腾讯行情"),
            "source_url": "https://gu.qq.com/",
            "updated_at": as_of(None),
            "market": market,
            "requested": len(stocks),
            "returned": len(quotes),
        }
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


def tencent_code(symbol, market, yahoo_symbol):
    if market == "A":
        return f"{'sh' if yahoo_symbol.endswith('.SS') else 'sz'}{symbol}"
    if market == "HK":
        return f"hk{symbol.zfill(5)}"
    return f"us{symbol}"


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
    rows = fetch_eastmoney_ulist_rows(secids, fields, batch_size=20)
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
    catalog = refresh_catalog()
    now = time.time()
    max_age = int(quote_settings().get("max_age_seconds", 1800))
    markets = {}
    quote_provider = None
    quote_error = None
    for market in ("A", "HK", "US"):
        first_index = (INDEX_UNIVERSES.get(market) or [{}])[0].get("code")
        sample = catalog_stock_tuples(market, first_index)[:120]
        payload = fetch_quotes_for_stocks(sample, market)
        quote_provider = payload.get("provider") or quote_provider
        if payload.get("error"):
            quote_error = payload.get("error")
        rows = payload.get("quotes", [])
        timestamps = [row.get("market_timestamp") for row in rows if row.get("market_timestamp")]
        newest = max(timestamps) if timestamps else None
        age = max(0, int(now - newest)) if newest else None
        freshness = market_freshness(market, newest, now=now, max_age=max_age)
        markets[market] = {
            "count": len(rows),
            "catalog_count": catalog["markets"][market]["count"],
            "sample_requested": len(sample),
            "indices": catalog["markets"][market]["indices"],
            "latest_market_time": format_market_time(newest, market),
            "age_seconds": age,
            **freshness,
        }
    financial_probes = {
        "A": get_financials("600519", "A"),
        "HK": get_financials("0700", "HK"),
        "US": get_financials("AAPL", "US"),
    }
    financials = {
        market: {
            "ok": bool(result.get("financials")),
            "rows": len(result.get("financials") or []),
            "provider": result.get("provider"),
            "source_url": result.get("source_url"),
            "error": result.get("error"),
        }
        for market, result in financial_probes.items()
    }
    healthy = all(
        item["catalog_count"] > 0 and item["count"] > 0 and item["fresh"] for item in markets.values()
    ) and bool(financials["A"]["ok"] and financials["HK"]["ok"] and financials["US"]["ok"])
    return {
        "status": "ok" if healthy else "degraded",
        "quote_provider": quote_provider,
        "quote_error": quote_error,
        "catalog_total": catalog["total"],
        "markets": markets,
        "financials": financials,
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


def get_runtime_info():
    version = "0.0.0"
    try:
        from desktop.version import __version__ as desktop_version

        version = desktop_version
    except Exception:
        pass
    return {
        "app": "StockAgent",
        "version": version,
        "mode": "desktop" if os.environ.get("STOCKAGENT_DESKTOP") == "1" else "server",
        "resource_root": str(RESOURCE_ROOT),
        "data_dir": str(DATA_DIR),
        "config_path": str(CONFIG_PATH),
        "workspace_path": str(WORKSPACE_PATH),
        "catalog_cache_path": str(CATALOG_DISK_CACHE),
        "platform": sys.platform,
        "python": sys.version.split()[0],
        "frozen": bool(getattr(sys, "frozen", False)),
    }


def create_server(host="127.0.0.1", port=None, dual_stack=False):
    """Create the HTTP server. port=None or 0 picks an ephemeral free port."""
    load_config()
    if port is None:
        configured = int(CONFIG.get("server", {}).get("port", 5174))
        port = configured
    if dual_stack:
        try:
            server = ThreadingHTTPServer(("::", port), Handler)
            if hasattr(server.socket, "setsockopt") and hasattr(socket, "IPV6_V6ONLY"):
                server.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
            return server
        except OSError:
            pass
    server = ThreadingHTTPServer((host, port), Handler)
    server.allow_reuse_address = True
    return server


def serve_forever(host="127.0.0.1", port=None, dual_stack=False):
    server = create_server(host=host, port=port, dual_stack=dual_stack)
    bound_host, bound_port = server.server_address[:2]
    print(f"StockAgent running at http://127.0.0.1:{bound_port} (bound {bound_host}:{bound_port})", flush=True)
    print(f"data_dir={DATA_DIR}", flush=True)
    server.serve_forever()
    return server


load_config()


if __name__ == "__main__":
    # CLI / browser mode: keep previous dual-stack localhost behavior.
    desktop = os.environ.get("STOCKAGENT_DESKTOP") == "1"
    if desktop:
        serve_forever(host="127.0.0.1", port=0, dual_stack=False)
    else:
        port = int(CONFIG.get("server", {}).get("port", 5174))
        serve_forever(host="0.0.0.0", port=port, dual_stack=True)

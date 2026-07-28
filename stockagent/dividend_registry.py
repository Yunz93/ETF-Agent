"""ETF-to-index analysis configuration and routing."""

from .defaults import DEFAULT_CONFIG, ETF_ANALYSIS_REGISTRY
from .state import CONFIG
from .symbols import as_of
from .dividend_constants import DISCLAIMER

def dividend_settings():
    merged = dict(DEFAULT_CONFIG.get("dividend", {}))
    merged.update(CONFIG.get("dividend") or {})
    return merged

def _normalize_etf_symbol(raw):
    digits = "".join(ch for ch in str(raw or "") if ch.isdigit())
    symbol = digits.zfill(6) if digits else ""
    return symbol if len(symbol) == 6 else ""

def analysis_registry():
    """内置映射 + config.etf.analysis 覆盖。"""
    registry = {key: dict(value) for key, value in ETF_ANALYSIS_REGISTRY.items()}
    custom = (CONFIG.get("etf") or {}).get("analysis") or {}
    if isinstance(custom, dict):
        for key, value in custom.items():
            symbol = _normalize_etf_symbol(key)
            if not symbol or not isinstance(value, dict):
                continue
            entry = dict(registry.get(symbol) or {})
            entry.update({k: v for k, v in value.items() if v is not None and v != ""})
            if entry.get("index_code"):
                registry[symbol] = entry
    return registry

NAME_INFER_RULES = (
    (("红利低波", "红利低波动"), {"index_code": "H30269", "index_name": "红利低波", "index_full_name": "中证红利低波", "danjuan_code": "CSIH30269"}),
    (("沪深300",), {"index_code": "000300", "index_name": "沪深300", "index_full_name": "沪深300", "danjuan_code": "CSI000300"}),
    (("中证500",), {"index_code": "000905", "index_name": "中证500", "index_full_name": "中证500", "danjuan_code": "CSI000905"}),
    (("中证1000",), {"index_code": "000852", "index_name": "中证1000", "index_full_name": "中证1000", "danjuan_code": "CSI000852"}),
    (("创业板",), {"index_code": "399006", "index_name": "创业板指", "index_full_name": "创业板指数", "danjuan_code": "SZ399006", "history_source": "sina"}),
    (("中证A500", "A500"), {"index_code": "000510", "index_name": "中证A500", "index_full_name": "中证A500", "danjuan_code": "", "history_source": "csindex"}),
    (("上证50",), {"index_code": "000016", "index_name": "上证50", "index_full_name": "上证50", "danjuan_code": "CSI000016"}),
    (("恒生科技",), {"index_code": "HSTECH", "index_name": "恒生科技", "index_full_name": "恒生科技指数", "danjuan_code": "HKHSTECH", "history_source": "tencent", "history_symbol": "hkHSTECH"}),
    (("标普500", "S&P500", "SP500"), {"index_code": "SPX", "index_name": "标普500", "index_full_name": "标普500", "danjuan_code": "SP500", "history_source": "tencent", "history_symbol": "us.INX"}),
    (("纳指", "纳斯达克100", "纳斯达克"), {"index_code": "NDX", "index_name": "纳斯达克100", "index_full_name": "纳斯达克100", "danjuan_code": "NDX", "history_source": "tencent", "history_symbol": "us.NDX"}),
)

def infer_mapping_from_name(name):
    text = str(name or "")
    if not text:
        return None
    for keywords, mapping in NAME_INFER_RULES:
        if any(key in text for key in keywords):
            return dict(mapping)
    return None

def etf_proxy_settings(symbol, name=""):
    """无指数映射时：用 ETF 自身行情做技术面 / 定投档位分析。"""
    base = dividend_settings()
    label = str(name or "").strip() or symbol
    return {
        **base,
        "etf_symbol": symbol,
        "etf_name": label,
        "index_code": symbol,
        "index_name": label,
        "index_full_name": label,
        "danjuan_code": "",
        "history_source": "etf",
        "analysis_mode": "etf_proxy",
    }

def resolve_analysis_settings(symbol=None, name=""):
    """解析某只 ETF 的分析配置。

    - symbol 为空：使用全局 dividend 设置
    - 注册表命中 / 名称推断命中：完整指数分析
    - 否则：ETF 行情兜底（analysis_mode=etf_proxy），保证入池即可分析
    """
    base = dividend_settings()
    symbol = _normalize_etf_symbol(symbol) if symbol else ""
    if not symbol:
        settings = dict(base)
        settings["etf_symbol"] = _normalize_etf_symbol(settings.get("etf_symbol")) or "512890"
        settings["analysis_mode"] = "index"
        return settings

    registry = analysis_registry()
    mapped = registry.get(symbol)
    if mapped:
        settings = dict(base)
        settings.update(mapped)
        settings["etf_symbol"] = symbol
        if not settings.get("etf_name"):
            settings["etf_name"] = str(name or "").strip() or symbol
        settings["analysis_mode"] = "index"
        return settings

    default_etf = _normalize_etf_symbol(base.get("etf_symbol"))
    if symbol == default_etf:
        settings = dict(base)
        settings["etf_symbol"] = symbol
        if name:
            settings["etf_name"] = str(name).strip()
        settings["analysis_mode"] = "index"
        return settings

    inferred = infer_mapping_from_name(name)
    if inferred:
        settings = dict(base)
        settings.update(inferred)
        settings["etf_symbol"] = symbol
        settings["etf_name"] = str(name or "").strip() or symbol
        settings["analysis_mode"] = "index"
        return settings

    return etf_proxy_settings(symbol, name)

def analysis_support_map(symbols=None):
    registry = analysis_registry()
    default_etf = _normalize_etf_symbol(dividend_settings().get("etf_symbol"))
    if symbols:
        wanted = [_normalize_etf_symbol(item) for item in symbols]
        wanted = [item for item in wanted if item]
    else:
        wanted = sorted(set(registry) | ({default_etf} if default_etf else set()))

    result = {}
    for symbol in wanted:
        settings = resolve_analysis_settings(symbol)
        result[symbol] = {
            "supported": True,
            "mode": settings.get("analysis_mode") or "index",
            "etf_symbol": symbol,
            "etf_name": settings.get("etf_name") or symbol,
            "index_code": settings.get("index_code"),
            "index_name": settings.get("index_name"),
            "index_full_name": settings.get("index_full_name"),
            "danjuan_code": settings.get("danjuan_code"),
        }
    return result

def unsupported_analysis_payload(symbol, name=""):
    """保留兼容；入池 ETF 已改为始终可分析，正常路径不再返回此结构。"""
    symbol = _normalize_etf_symbol(symbol) or str(symbol or "")
    return {
        "supported": False,
        "symbol": symbol,
        "name": name or symbol,
        "etf": {"symbol": symbol, "name": name or symbol},
        "error": "暂不支持完整估值分析",
        "reason": "无法解析该代码。请确认是有效的 A 股场内 ETF。",
        "updated_at": as_of(None),
        "disclaimer": DISCLAIMER,
    }

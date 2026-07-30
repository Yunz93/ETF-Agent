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
    (("红利低波", "红利低波动"), {"index_code": "H30269", "index_name": "红利低波", "index_full_name": "中证红利低波", "danjuan_code": "CSIH30269", "asset_class": "dividend"}),
    (("中证红利",), {"index_code": "000922", "index_name": "中证红利", "index_full_name": "中证红利", "danjuan_code": "SH000922", "history_source": "csindex", "asset_class": "dividend"}),
    (("沪深300",), {"index_code": "000300", "index_name": "沪深300", "index_full_name": "沪深300", "danjuan_code": "CSI000300", "asset_class": "equity_core"}),
    (("中证500",), {"index_code": "000905", "index_name": "中证500", "index_full_name": "中证500", "danjuan_code": "CSI000905", "asset_class": "equity_core"}),
    (("中证1000",), {"index_code": "000852", "index_name": "中证1000", "index_full_name": "中证1000", "danjuan_code": "CSI000852", "asset_class": "equity_core"}),
    (("科创50", "科创板50"), {"index_code": "000688", "index_name": "科创50", "index_full_name": "上证科创板50成份", "danjuan_code": "SH000688", "history_source": "csindex", "asset_class": "equity_growth"}),
    (("创业板",), {"index_code": "399006", "index_name": "创业板指", "index_full_name": "创业板指数", "danjuan_code": "SZ399006", "history_source": "sina", "asset_class": "equity_growth"}),
    (("中证A500", "A500"), {"index_code": "000510", "index_name": "中证A500", "index_full_name": "中证A500", "danjuan_code": "", "history_source": "csindex", "asset_class": "equity_core"}),
    (("上证50",), {"index_code": "000016", "index_name": "上证50", "index_full_name": "上证50", "danjuan_code": "CSI000016", "asset_class": "equity_core"}),
    (("恒生科技",), {"index_code": "HSTECH", "index_name": "恒生科技", "index_full_name": "恒生科技指数", "danjuan_code": "HKHSTECH", "history_source": "tencent", "history_symbol": "hkHSTECH", "asset_class": "equity_growth"}),
    (("恒生指数", "恒生ETF"), {"index_code": "HSI", "index_name": "恒生指数", "index_full_name": "恒生指数", "danjuan_code": "HKHSI", "history_source": "tencent", "history_symbol": "hkHSI", "asset_class": "equity_core"}),
    (("标普500", "S&P500", "SP500"), {"index_code": "SPX", "index_name": "标普500", "index_full_name": "标普500", "danjuan_code": "SP500", "history_source": "tencent", "history_symbol": "us.INX", "asset_class": "equity_growth"}),
    (("纳指", "纳斯达克100", "纳斯达克"), {"index_code": "NDX", "index_name": "纳斯达克100", "index_full_name": "纳斯达克100", "danjuan_code": "NDX", "history_source": "tencent", "history_symbol": "us.NDX", "asset_class": "equity_growth"}),
)

# 代理模式（无指数映射）下按名称粗分资产类别，用于给出准确的降级说明。
PROXY_ASSET_RULES = (
    ("commodity", ("黄金", "白银", "贵金属", "豆粕", "原油", "石油", "天然气", "能源化工", "有色", "商品", "饲料")),
    ("bond", ("国债", "政金债", "金融债", "信用债", "城投债", "短融", "债券", "转债", "可转债", "货币", "存单", "国开")),
)

# 定投策略用的资产类别枚举（与 PROXY 的 equity 不同：股票兜底为 equity_core）。
ASSET_CLASS_IDS = ("dividend", "commodity", "bond", "equity_growth", "equity_core")
DIVIDEND_INDEX_CODES = frozenset({"H30269", "000922"})
ASSET_CLASS_RULES = (
    ("dividend", ("红利低波", "红利低波动", "中证红利", "高股息", "红利")),
    ("equity_growth", ("纳指", "纳斯达克", "标普500", "S&P500", "SP500", "恒生科技", "科创", "创业板")),
    ("equity_core", ("中证A500", "A500", "沪深300", "中证500", "中证1000", "上证50", "恒生指数", "恒生ETF")),
)

PROXY_VALUATION_NOTES = {
    "commodity": "黄金/商品类 ETF 没有 PE、股息率等股票估值口径，本页以行情技术面为主（估值与股债利差不适用）",
    "bond": "债券/货币类 ETF 没有股票估值口径，本页以行情技术面为主（估值与股债利差不适用）",
    "equity": "该 ETF 暂未收录指数估值映射，本页以行情技术面为主（PE/股债利差暂缺）；可在 config.json 的 etf.analysis 添加映射",
}

def proxy_asset_class(name):
    text = str(name or "")
    for asset_class, keywords in PROXY_ASSET_RULES:
        if any(key in text for key in keywords):
            return asset_class
    return "equity"

def proxy_valuation_note(name):
    return PROXY_VALUATION_NOTES[proxy_asset_class(name)]

def _map_proxy_to_asset_class(proxy):
    """把 PROXY 粗分类映射到定投用枚举。"""
    if proxy in ("commodity", "bond"):
        return proxy
    return "equity_core"

def resolve_asset_class(name="", index_code="", index_name="", etf_name="", analysis_mode=None, explicit=None):
    """解析定投用资产类别。explicit 优先；etf_proxy 映射 PROXY；否则按代码/名称规则。"""
    if explicit in ASSET_CLASS_IDS:
        return explicit
    label = str(name or etf_name or index_name or "").strip()
    if analysis_mode == "etf_proxy":
        return _map_proxy_to_asset_class(proxy_asset_class(label))

    code = str(index_code or "").strip().upper()
    if code in DIVIDEND_INDEX_CODES:
        return "dividend"

    text = " ".join(part for part in (str(name or ""), str(index_name or ""), str(etf_name or "")) if part)
    for asset_class, keywords in PROXY_ASSET_RULES:
        if any(key in text for key in keywords):
            return asset_class
    for asset_class, keywords in ASSET_CLASS_RULES:
        if any(key in text for key in keywords):
            return asset_class
    return "equity_core"

def _attach_asset_class(settings, name=""):
    """确保 settings 带有 asset_class。"""
    settings["asset_class"] = resolve_asset_class(
        name=name or settings.get("etf_name") or "",
        index_code=settings.get("index_code") or "",
        index_name=settings.get("index_name") or "",
        etf_name=settings.get("etf_name") or "",
        analysis_mode=settings.get("analysis_mode"),
        explicit=settings.get("asset_class"),
    )
    return settings

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
    return _attach_asset_class({
        **base,
        "etf_symbol": symbol,
        "etf_name": label,
        "index_code": symbol,
        "index_name": label,
        "index_full_name": label,
        "danjuan_code": "",
        "history_source": "etf",
        "analysis_mode": "etf_proxy",
        "asset_class": _map_proxy_to_asset_class(proxy_asset_class(label)),
    }, name=label)

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
        return _attach_asset_class(settings, name=name)

    registry = analysis_registry()
    mapped = registry.get(symbol)
    if mapped:
        settings = dict(base)
        settings.update(mapped)
        settings["etf_symbol"] = symbol
        if not settings.get("etf_name"):
            settings["etf_name"] = str(name or "").strip() or symbol
        settings["analysis_mode"] = "index"
        return _attach_asset_class(settings, name=name)

    default_etf = _normalize_etf_symbol(base.get("etf_symbol"))
    if symbol == default_etf:
        settings = dict(base)
        settings["etf_symbol"] = symbol
        if name:
            settings["etf_name"] = str(name).strip()
        settings["analysis_mode"] = "index"
        return _attach_asset_class(settings, name=name)

    inferred = infer_mapping_from_name(name)
    if inferred:
        settings = dict(base)
        settings.update(inferred)
        settings["etf_symbol"] = symbol
        settings["etf_name"] = str(name or "").strip() or symbol
        settings["analysis_mode"] = "index"
        return _attach_asset_class(settings, name=name)

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

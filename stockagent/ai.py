#!/usr/bin/env python3
"""AI provider configuration, testing, and stock analysis prompts."""

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

from .defaults import *
from .config_store import ai_settings
from .http_client import http_post_json
from .symbols import as_of
from .quotes import get_price_history
from .financials import get_financials

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

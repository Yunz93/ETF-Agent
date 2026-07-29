#!/usr/bin/env python3
"""Build, validate, and safely arbitrate AI recommendation corrections."""

from __future__ import annotations

import datetime
import hashlib
import json
import time

from .ai_providers import AIProviderError, request_review
from .config_store import ai_settings
from .dividend import get_dividend_dashboard
from .market_time import market_freshness
from .secret_store import credential_status, get_api_key
from .state import AI_REVIEW_CACHE
from .workspace_store import get_workspace

SYSTEM_PROMPT = """你是 ETF Agent 的投资建议复核器。只能使用输入 JSON 中的事实，
不得补充新闻、财报、行情或外部知识。你的任务是校正规则建议中的明显盲点，而不是取代规则引擎。
证据必须写成输入字段路径，例如 analysis.valuation.pe_percentile_10y。
数据不足时降低置信度并保持原建议。不要承诺收益，不要给出确定性买卖指令。
只返回 JSON 对象，不要添加 Markdown。对象必须包含以下字段：
action: "keep" | "increase" | "reduce" | "pause"；
amount_multiplier: 数字；confidence: "low" | "medium" | "high"；summary: 字符串；
supporting_factors、risks、watch_items、evidence、conditions_to_reverse、data_limitations: 字符串数组。
所有字段都必须出现；数组每项不超过 80 个汉字，最多 3 项，没有内容时返回空数组。"""

ALLOWED_ACTIONS = {"keep", "increase", "reduce", "pause"}
ALLOWED_CONFIDENCE = {"low", "medium", "high"}
def _number(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(default)


def _short_list(value, limit=3):
    if not isinstance(value, list):
        return []
    return [str(item).strip()[:160] for item in value if str(item).strip()][:limit]


def _analysis_snapshot(payload):
    return {
        "symbol": payload.get("symbol") or (payload.get("etf") or {}).get("symbol"),
        "analysis_mode": payload.get("analysis_mode"),
        "updated_at": payload.get("updated_at"),
        "etf": {
            key: (payload.get("etf") or {}).get(key)
            for key in (
                "symbol",
                "symbol_name",
                "price",
                "change_pct",
                "as_of",
                "market_timestamp",
                "provider",
            )
        },
        "index": {
            key: (payload.get("index") or {}).get(key)
            for key in ("date", "close", "change_pct")
        },
        "valuation": {
            key: (payload.get("valuation") or {}).get(key)
            for key in ("pe", "pb", "dividend_yield_pct", "pe_percentile_10y")
        },
        "bond": {"yield10y": (payload.get("bond") or {}).get("yield10y")},
        "spread": {
            key: (payload.get("spread") or {}).get(key)
            for key in ("value", "percentile", "label")
        },
        "technicals": {
            key: (payload.get("technicals") or {}).get(key)
            for key in ("bias_pct", "ma250", "rsi14", "rsi_label", "boll_position")
        },
        "score": {
            "total": (payload.get("score") or {}).get("total"),
            "grade": (payload.get("score") or {}).get("grade"),
            "components": (payload.get("score") or {}).get("components"),
        },
        "backtest": {
            key: (payload.get("backtest") or {}).get(key)
            for key in ("samples", "horizon_days", "avg_return_pct", "win_rate_pct", "worst_pct")
        },
    }


def _workspace_snapshot(workspace, symbol):
    holding = next(
        (item for item in workspace.get("etfs") or [] if item.get("symbol") == symbol),
        {},
    )
    return {
        "plan_budget": _number((workspace.get("plan") or {}).get("amount")),
        "plan_strategy": (workspace.get("plan") or {}).get("strategy"),
        "holding": {
            key: holding.get(key) for key in ("symbol", "shares", "cost", "target_weight")
        },
    }


def _normalize_baseline(raw, workspace):
    if not isinstance(raw, dict):
        raise AIProviderError("缺少规则基线建议", status=400, code="invalid_request")
    amount = max(0.0, _number(raw.get("amount")))
    plan_budget = max(0.0, _number((workspace.get("plan") or {}).get("amount")))
    return {
        "stance": str(raw.get("stance") or "")[:40],
        "headline": str(raw.get("headline") or "")[:160],
        "reason": str(raw.get("reason") or "")[:240],
        "amount": min(amount, plan_budget),
        "remaining_amount": min(
            max(0.0, _number(raw.get("remaining_amount"), amount)), plan_budget
        ),
    }


def _data_quality(analysis):
    errors = analysis.get("errors") if isinstance(analysis.get("errors"), dict) else {}
    etf = analysis.get("etf") or {}
    freshness = market_freshness(
        etf.get("market") or "A",
        etf.get("market_timestamp"),
    ).get("status")
    updated_at = analysis.get("updated_at")
    critical_errors = sorted(
        key for key in errors if key in ("etf", "valuation", "index_pe", "bond")
    )
    return {
        "freshness": freshness,
        "updated_at": updated_at,
        "degraded_fields": sorted(errors.keys()),
        "critical_degraded_fields": critical_errors,
        "may_increase": not critical_errors and freshness in ("live", "recent_close"),
    }


def _evidence_paths(payload, prefix=""):
    paths = set()
    if isinstance(payload, dict):
        for key, value in payload.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            paths.add(path)
            paths.update(_evidence_paths(value, path))
    return paths


def _validate_proposal(raw, allowed_evidence=None):
    action = str(raw.get("action") or "").strip().lower()
    confidence = str(raw.get("confidence") or "").strip().lower()
    if action not in ALLOWED_ACTIONS or confidence not in ALLOWED_CONFIDENCE:
        raise AIProviderError("大模型校正字段无效", code="invalid_output")
    evidence = _short_list(raw.get("evidence"))
    valid_evidence = evidence if allowed_evidence is None else [
        item for item in evidence if item in allowed_evidence
    ]
    invalid_evidence = [item for item in evidence if item not in valid_evidence]
    data_limitations = _short_list(raw.get("data_limitations"))
    if invalid_evidence:
        confidence = "low"
        data_limitations = _short_list(
            [
                *data_limitations,
                "模型引用了不可验证字段，已忽略并保留规则建议。",
            ]
        )
    return {
        "action": action,
        "amount_multiplier": max(0.0, _number(raw.get("amount_multiplier"), 1)),
        "confidence": confidence,
        "summary": str(raw.get("summary") or "").strip()[:240],
        "supporting_factors": _short_list(raw.get("supporting_factors")),
        "risks": _short_list(raw.get("risks")),
        "watch_items": _short_list(raw.get("watch_items")),
        "evidence": valid_evidence,
        "conditions_to_reverse": _short_list(raw.get("conditions_to_reverse")),
        "data_limitations": data_limitations,
    }


def apply_policy(baseline, proposal, data_quality, position, settings):
    requested = proposal["amount_multiplier"]
    if proposal["action"] == "reduce":
        requested = min(1.0, requested)
    elif proposal["action"] == "increase":
        requested = max(1.0, requested)
    accepted = requested
    reasons = []
    if proposal["action"] == "pause":
        accepted = 0
    elif proposal["action"] == "keep":
        accepted = 1
    if proposal["confidence"] == "low":
        accepted = 1
        reasons.append("低置信度：保留规则建议")
    if not data_quality.get("may_increase") and accepted > 1:
        accepted = 1
        reasons.append("数据陈旧或降级：禁止提高投入")
    if position.get("blocked") or position.get("would_exceed"):
        if accepted > 1:
            accepted = 1
        reasons.append("仓位达到或将超过允许上限：禁止提高投入")
    accepted = min(
        max(0.0, accepted),
        _number(settings.get("max_increase_multiplier"), 1.5),
    )
    baseline_amount = max(0.0, _number(baseline.get("remaining_amount")))
    budget = max(0.0, _number(position.get("plan_budget")))
    final_amount = min(budget, baseline_amount * accepted)
    return {
        "status": "accepted" if accepted == requested else "adjusted",
        "requested_multiplier": round(requested, 2),
        "accepted_multiplier": round(accepted, 2),
        "reasons": reasons or ["校正提案符合风控约束"],
        "final_amount": round(final_amount, 2),
    }


def _position_snapshot(raw, workspace):
    source = raw if isinstance(raw, dict) else {}
    return {
        "target_weight": source.get("target_weight"),
        "actual_weight": source.get("actual_weight"),
        "projected_weight": source.get("projected_weight"),
        "blocked": source.get("blocked") is True,
        "would_exceed": source.get("would_exceed") is True,
        "plan_budget": _number((workspace.get("plan") or {}).get("amount")),
    }


def _cache_key(provider, model, payload):
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return f"{provider}:{model}:{hashlib.sha256(encoded).hexdigest()}"


def review_recommendation(request_payload, force=False):
    settings = ai_settings()
    if not settings.get("enabled"):
        raise AIProviderError("请先在设置中启用 AI 校正", status=409, code="disabled")
    provider = settings.get("provider")
    model = (settings.get("models") or {}).get(provider)
    api_key = get_api_key(provider)
    if not api_key:
        raise AIProviderError("请先配置当前提供商的 API Key", status=409, code="missing_key")

    symbol = "".join(ch for ch in str(request_payload.get("symbol") or "") if ch.isdigit()).zfill(6)
    if len(symbol) != 6 or not symbol.strip("0"):
        raise AIProviderError("ETF 代码无效", status=400, code="invalid_request")
    workspace = get_workspace()
    baseline = _normalize_baseline(request_payload.get("baseline"), workspace)
    position = _position_snapshot(request_payload.get("position"), workspace)
    analysis = get_dividend_dashboard(symbol=symbol)
    if analysis.get("supported") is False or (analysis.get("error") and not analysis.get("score")):
        raise AIProviderError("当前分析数据不可用，不能执行 AI 校正", status=409, code="data_unavailable")
    quality = _data_quality(analysis)
    model_input = {
        "analysis": _analysis_snapshot(analysis),
        "baseline": baseline,
        "workspace": _workspace_snapshot(workspace, symbol),
        "position": position,
        "data_quality": quality,
    }
    cache_key = _cache_key(provider, model, model_input)
    cached = AI_REVIEW_CACHE.get(cache_key)
    if not force and cached and cached["expires"] > time.time():
        return {**cached["payload"], "cached": True}

    raw, usage = request_review(
        provider,
        api_key,
        model,
        SYSTEM_PROMPT,
        model_input,
        int(settings.get("timeout_seconds", 60)),
        int(settings.get("max_output_tokens", 1800)),
    )
    proposal = _validate_proposal(raw, _evidence_paths(model_input))
    policy = apply_policy(baseline, proposal, quality, position, settings)
    result = {
        "baseline_recommendation": baseline,
        "ai_proposal": proposal,
        "policy_decision": policy,
        "final_recommendation": {
            "amount": policy["final_amount"],
            "action": proposal["action"],
            "summary": proposal["summary"],
            "is_correction": policy["accepted_multiplier"] != 1,
        },
        "provider": provider,
        "model": model,
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "input_as_of": analysis.get("updated_at"),
        "usage": usage,
        "cached": False,
        "disclaimer": "AI 校正仅供研究参考，不构成投资建议；不会自动下单或修改长期策略。",
    }
    cache_seconds = int(settings.get("cache_minutes", 30)) * 60
    if cache_seconds:
        AI_REVIEW_CACHE[cache_key] = {
            "expires": time.time() + cache_seconds,
            "payload": result,
        }
    return result


def ai_status():
    settings = ai_settings()
    provider = settings.get("provider")
    return {
        "enabled": settings.get("enabled") is True,
        "provider": provider,
        "model": (settings.get("models") or {}).get(provider),
        "credentials": {
            name: credential_status(name) for name in ("deepseek", "openai")
        },
    }


def test_connection(provider=None):
    settings = ai_settings()
    name = provider or settings.get("provider")
    model = (settings.get("models") or {}).get(name)
    api_key = get_api_key(name)
    if not api_key:
        raise AIProviderError("请先配置 API Key", status=409, code="missing_key")
    result, usage = request_review(
        name,
        api_key,
        model,
        SYSTEM_PROMPT,
        {
            "analysis": {},
            "baseline": {"amount": 0},
            "workspace": {},
            "position": {},
            "data_quality": {"may_increase": False},
        },
        min(30, int(settings.get("timeout_seconds", 60))),
        600,
    )
    return {"ok": True, "provider": name, "model": model, "usage": usage}

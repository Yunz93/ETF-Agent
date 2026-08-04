#!/usr/bin/env python3
"""Provider-specific transport for AI recommendation review."""

from __future__ import annotations

import json
import socket
import urllib.error

from .http_client import http_post_json

PROVIDER_URLS = {
    "deepseek": "https://api.deepseek.com/chat/completions",
    "openai": "https://api.openai.com/v1/responses",
}


class AIProviderError(RuntimeError):
    def __init__(self, message, status=502, code="provider_error"):
        super().__init__(message)
        self.status = status
        self.code = code


def _decode_json_text(text):
    value = str(text or "").strip()
    if value.startswith("```"):
        lines = value.splitlines()
        value = "\n".join(lines[1:-1]).strip()
        if value.lower().startswith("json"):
            value = value[4:].lstrip()
    try:
        payload = json.loads(value)
    except json.JSONDecodeError as exc:
        raise AIProviderError("大模型返回了无法解析的结构化结果", code="invalid_output") from exc
    if not isinstance(payload, dict):
        raise AIProviderError("大模型返回结果不是对象", code="invalid_output")
    return payload


def _translate_transport_error(exc):
    if isinstance(exc, urllib.error.HTTPError):
        if exc.code == 401:
            return AIProviderError("API Key 无效或无权限", status=401, code="authentication")
        if exc.code == 429:
            return AIProviderError("大模型请求过于频繁或余额不足", status=429, code="rate_limit")
        return AIProviderError(f"大模型服务返回 HTTP {exc.code}", status=502)
    if isinstance(exc, (TimeoutError, socket.timeout)):
        return AIProviderError("大模型请求超时", status=504, code="timeout")
    if isinstance(exc, urllib.error.URLError):
        return AIProviderError("无法连接大模型服务", status=502, code="network")
    return AIProviderError("大模型服务调用失败", status=502)


def _deepseek_request(api_key, model, system_prompt, user_payload, timeout, max_tokens):
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
        ],
        "thinking": {"type": "disabled"},
        "response_format": {"type": "json_object"},
        "max_tokens": max_tokens,
        "stream": False,
    }
    response = http_post_json(
        PROVIDER_URLS["deepseek"],
        body,
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=timeout,
    )
    choices = response.get("choices") or []
    content = choices[0].get("message", {}).get("content") if choices else None
    return _decode_json_text(content), response.get("usage") or {}


RECOMMENDATION_REVIEW_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "action",
        "amount_multiplier",
        "confidence",
        "summary",
        "focus_title",
        "analysis_sections",
        "watch_items",
        "evidence",
        "conditions_to_reverse",
        "data_limitations",
    ],
    "properties": {
        "action": {"type": "string", "enum": ["keep", "increase", "reduce", "pause"]},
        "amount_multiplier": {"type": "number"},
        "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
        "summary": {"type": "string"},
        "focus_title": {"type": "string"},
        "analysis_sections": {
            "type": "array",
            "minItems": 2,
            "maxItems": 4,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["title", "items"],
                "properties": {
                    "title": {"type": "string"},
                    "items": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 3,
                        "items": {"type": "string"},
                    },
                },
            },
        },
        "watch_items": {"type": "array", "items": {"type": "string"}},
        "evidence": {"type": "array", "items": {"type": "string"}},
        "conditions_to_reverse": {"type": "array", "items": {"type": "string"}},
        "data_limitations": {"type": "array", "items": {"type": "string"}},
    },
}

PORTFOLIO_REVIEW_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "action",
        "confidence",
        "summary",
        "focus_title",
        "analysis_sections",
        "per_symbol_adjustments",
        "watch_items",
        "evidence",
        "conditions_to_reverse",
        "data_limitations",
    ],
    "properties": {
        "action": {"type": "string", "enum": ["keep", "adjust"]},
        "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
        "summary": {"type": "string"},
        "focus_title": {"type": "string"},
        "analysis_sections": RECOMMENDATION_REVIEW_SCHEMA["properties"]["analysis_sections"],
        "per_symbol_adjustments": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["symbol", "multiplier", "reason"],
                "properties": {
                    "symbol": {"type": "string"},
                    "multiplier": {"type": "number"},
                    "reason": {"type": "string"},
                },
            },
        },
        "watch_items": {"type": "array", "items": {"type": "string"}},
        "evidence": {"type": "array", "items": {"type": "string"}},
        "conditions_to_reverse": {"type": "array", "items": {"type": "string"}},
        "data_limitations": {"type": "array", "items": {"type": "string"}},
    },
}


def _openai_request(
    api_key,
    model,
    system_prompt,
    user_payload,
    timeout,
    max_tokens,
    response_schema=None,
    schema_name="recommendation_review",
):
    schema = response_schema or RECOMMENDATION_REVIEW_SCHEMA
    body = {
        "model": model,
        "instructions": system_prompt,
        "input": json.dumps(user_payload, ensure_ascii=False),
        "max_output_tokens": max_tokens,
        "text": {
            "format": {
                "type": "json_schema",
                "name": schema_name,
                "strict": True,
                "schema": schema,
            }
        },
    }
    response = http_post_json(
        PROVIDER_URLS["openai"],
        body,
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=timeout,
    )
    text = response.get("output_text")
    if not text:
        for item in response.get("output") or []:
            for content in item.get("content") or []:
                if content.get("type") == "output_text":
                    text = content.get("text")
                    break
    return _decode_json_text(text), response.get("usage") or {}


def request_review(
    provider,
    api_key,
    model,
    system_prompt,
    user_payload,
    timeout,
    max_tokens,
    response_schema=None,
    schema_name="recommendation_review",
):
    try:
        if provider == "deepseek":
            return _deepseek_request(
                api_key, model, system_prompt, user_payload, timeout, max_tokens
            )
        if provider == "openai":
            return _openai_request(
                api_key,
                model,
                system_prompt,
                user_payload,
                timeout,
                max_tokens,
                response_schema=response_schema,
                schema_name=schema_name,
            )
        raise AIProviderError("不支持的大模型提供商", status=400, code="invalid_provider")
    except AIProviderError:
        raise
    except Exception as exc:
        raise _translate_transport_error(exc) from exc

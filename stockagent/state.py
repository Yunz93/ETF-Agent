#!/usr/bin/env python3
"""Mutable backend process state and caches."""

import json

from .defaults import DEFAULT_CONFIG

CONFIG = json.loads(json.dumps(DEFAULT_CONFIG))
QUOTE_MARKET_CACHE = {}
QUOTE_CACHE = {"expires": 0, "payload": None}
HISTORY_CACHE = {}
SENTIMENT_CACHE = {}
AI_REVIEW_CACHE = {}
# 进程内 AI token 用量累计（重启清零）
AI_USAGE_SESSION = {
    "requests": 0,
    "prompt_tokens": 0,
    "completion_tokens": 0,
}

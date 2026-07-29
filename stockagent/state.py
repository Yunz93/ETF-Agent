#!/usr/bin/env python3
"""Mutable backend process state and caches."""

import json

from .defaults import DEFAULT_CONFIG

CONFIG = json.loads(json.dumps(DEFAULT_CONFIG))
QUOTE_MARKET_CACHE = {}
QUOTE_CACHE = {"expires": 0, "payload": None}
HISTORY_CACHE = {}
AI_REVIEW_CACHE = {}

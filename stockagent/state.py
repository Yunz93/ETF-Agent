#!/usr/bin/env python3
"""Mutable backend process state and caches."""

import json
import threading

from .defaults import DEFAULT_CONFIG
from .paths import DATA_DIR

CONFIG = json.loads(json.dumps(DEFAULT_CONFIG))
CATALOG_CACHE = {"expires": 0, "payload": None, "by_key": {}, "stocks": []}
CATALOG_DISK_CACHE = DATA_DIR / ".catalog-cache.json"
SEC_CIK_CACHE = {"expires": 0, "payload": {}}
QUOTE_MARKET_CACHE = {}

QUOTE_CACHE = {"expires": 0, "payload": None}
HISTORY_CACHE = {}
SEC_CACHE = {}
FILINGS_CACHE = {}
FINANCIAL_CACHE = {}
YAHOO_SESSION = {"expires": 0, "opener": None, "crumb": None}
YAHOO_LOCK = threading.Lock()

#!/usr/bin/env python3
"""Backward-compatible facade for the StockAgent backend package.

The backend implementation lives in :mod:`stockagent`. This module keeps
``import server`` and ``python3 server.py`` working for desktop and browser
entrypoints.
"""

from __future__ import annotations

import os
import sys
import types

from stockagent import paths as _paths
from stockagent import defaults as _defaults
from stockagent import state as _state
from stockagent import http_client as _http_client
from stockagent import symbols as _symbols
from stockagent import market_time as _market_time
from stockagent import config_store as _config_store
from stockagent import workspace_store as _workspace_store
from stockagent import indicators as _indicators
from stockagent import catalog as _catalog
from stockagent import quotes as _quotes
from stockagent import dividend as _dividend
from stockagent import financials as _financials
from stockagent import ai as _ai
from stockagent import health as _health
from stockagent import handler as _handler
from stockagent import serve as _serve

from stockagent.paths import *  # noqa: F401,F403
from stockagent.defaults import *  # noqa: F401,F403
from stockagent.state import *  # noqa: F401,F403
from stockagent.http_client import *  # noqa: F401,F403
from stockagent.symbols import *  # noqa: F401,F403
from stockagent.market_time import *  # noqa: F401,F403
from stockagent.config_store import *  # noqa: F401,F403
from stockagent.workspace_store import *  # noqa: F401,F403
from stockagent.indicators import *  # noqa: F401,F403
from stockagent.catalog import *  # noqa: F401,F403
from stockagent.quotes import *  # noqa: F401,F403
from stockagent.dividend import *  # noqa: F401,F403
from stockagent.financials import *  # noqa: F401,F403
from stockagent.ai import *  # noqa: F401,F403
from stockagent.health import *  # noqa: F401,F403
from stockagent.handler import *  # noqa: F401,F403
from stockagent.serve import *  # noqa: F401,F403

_MODULES = [
    _paths,
    _defaults,
    _state,
    _http_client,
    _symbols,
    _market_time,
    _config_store,
    _workspace_store,
    _indicators,
    _catalog,
    _quotes,
    _dividend,
    _financials,
    _ai,
    _health,
    _handler,
    _serve,
]

_NAME_TO_MODULE = {}
_NAME_TO_MODULES = {}
for _module in _MODULES:
    for _name, _value in vars(_module).items():
        if _name.startswith("__"):
            continue
        globals()[_name] = _value
        _NAME_TO_MODULE[_name] = _module
        _NAME_TO_MODULES.setdefault(_name, []).append(_module)

# Preserve import-time config loading from the historical monolithic module.
load_config()
CONFIG = _state.CONFIG


class _ServerFacade(types.ModuleType):
    def __setattr__(self, name, value):
        modules = globals().get("_NAME_TO_MODULES", {}).get(name, ())
        for module in modules:
            setattr(module, name, value)
        super().__setattr__(name, value)


sys.modules[__name__].__class__ = _ServerFacade

__all__ = sorted(name for name in _NAME_TO_MODULE if not name.startswith("__"))


if __name__ == "__main__":
    # CLI / browser mode: keep previous dual-stack localhost behavior.
    desktop = os.environ.get("STOCKAGENT_DESKTOP") == "1"
    if desktop:
        serve_forever(host="127.0.0.1", port=0, dual_stack=False)
    else:
        port = int(CONFIG.get("server", {}).get("port", 5174))
        serve_forever(host="0.0.0.0", port=port, dual_stack=True)

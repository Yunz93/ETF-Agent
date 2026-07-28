"""Compatibility facade for the modular ETF analysis implementation."""

from .dividend_constants import *  # noqa: F401,F403
from .dividend_registry import *  # noqa: F401,F403
from .dividend_sources import *  # noqa: F401,F403
from .dividend_analysis import *  # noqa: F401,F403
from .dividend_service import *  # noqa: F401,F403

# Private helpers historically used by tests and the server facade.
from .dividend_registry import _normalize_etf_symbol
from .dividend_sources import _market_prefixed_index

"""Single source of truth for StockAgent desktop versioning."""

from __future__ import annotations

__version__ = "0.1.0"
APP_NAME = "StockAgent"
BUNDLE_ID = "com.stockagent.desktop"
CF_BUNDLE_NAME = "StockAgent"


def version_parts() -> tuple[str, str, str]:
    parts = (__version__ + ".0.0").split(".")
    return parts[0], parts[1], parts[2]


def build_number(fallback: str | None = None) -> str:
    import os

    return (
        os.environ.get("STOCKAGENT_BUILD_NUMBER")
        or os.environ.get("GITHUB_RUN_NUMBER")
        or fallback
        or __version__.replace(".", "")
    )

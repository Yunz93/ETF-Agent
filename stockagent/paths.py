#!/usr/bin/env python3
"""Filesystem and runtime path resolution."""

import os
import sys
import threading
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def _resolve_resource_root():
    raw = os.environ.get("STOCKAGENT_RESOURCE_DIR")
    if raw:
        return Path(raw).expanduser().resolve()
    # PyInstaller onefile/onedir support
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS).resolve()
    return REPO_ROOT


def _resolve_data_dir():
    raw = os.environ.get("STOCKAGENT_DATA_DIR")
    if raw:
        path = Path(raw).expanduser().resolve()
    elif os.environ.get("STOCKAGENT_DESKTOP") == "1":
        if sys.platform == "darwin":
            path = Path.home() / "Library" / "Application Support" / "StockAgent"
        elif sys.platform == "win32":
            base = os.environ.get("APPDATA") or str(Path.home())
            path = Path(base) / "StockAgent"
        else:
            path = Path.home() / ".local" / "share" / "StockAgent"
    else:
        path = REPO_ROOT
    path.mkdir(parents=True, exist_ok=True)
    (path / "logs").mkdir(parents=True, exist_ok=True)
    return path


RESOURCE_ROOT = _resolve_resource_root()
DATA_DIR = _resolve_data_dir()
# Back-compat alias used by older helpers / docs.
ROOT = RESOURCE_ROOT
CONFIG_PATH = DATA_DIR / "config.json"
WORKSPACE_PATH = DATA_DIR / "workspace.json"
WORKSPACE_LOCK = threading.Lock()

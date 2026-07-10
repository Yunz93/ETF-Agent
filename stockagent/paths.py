#!/usr/bin/env python3
"""Filesystem and runtime path resolution."""

from __future__ import annotations

import os
import sys
import threading
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def _has_ui(path: Path) -> bool:
    return (path / "index.html").is_file()


def _frozen_resource_candidates() -> list[Path]:
    """Possible UI roots inside a PyInstaller macOS .app / onedir build."""
    candidates: list[Path] = []
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        candidates.append(Path(meipass))
    exe = Path(sys.executable).resolve()
    # StockAgent.app/Contents/MacOS/StockAgent → Contents/{Frameworks,Resources}
    macos_dir = exe.parent
    contents_dir = macos_dir.parent
    candidates.extend(
        [
            macos_dir,
            contents_dir / "Frameworks",
            contents_dir / "Resources",
            contents_dir,
        ]
    )
    # De-dupe while preserving order.
    seen: set[str] = set()
    unique: list[Path] = []
    for raw in candidates:
        try:
            path = raw.expanduser().resolve()
        except OSError:
            continue
        key = str(path)
        if key in seen:
            continue
        seen.add(key)
        unique.append(path)
    return unique


def _resolve_resource_root():
    raw = os.environ.get("STOCKAGENT_RESOURCE_DIR")
    if raw:
        path = Path(raw).expanduser().resolve()
        if _has_ui(path):
            return path
        # Env may point at MacOS/ or an unresolved symlink; keep searching.
    if getattr(sys, "frozen", False):
        for candidate in _frozen_resource_candidates():
            if _has_ui(candidate):
                return candidate
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            return Path(meipass).resolve()
        return Path(sys.executable).resolve().parent
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


def resource_root() -> Path:
    """Return the current UI/resource root (re-evaluates env / frozen layout)."""
    return _resolve_resource_root()


def resolve_static_path(url_path: str) -> Path | None:
    """Map a URL path to a file under the resource root, safely.

    Uses Path.relative_to after resolve() so macOS /var vs /private/var
    symlink normalization cannot false-negative a startswith() check.
    """
    rel = (url_path or "/").split("?", 1)[0].split("#", 1)[0]
    if rel in {"", "/"}:
        rel = "index.html"
    rel = rel.lstrip("/")
    if not rel or ".." in Path(rel).parts:
        return None

    roots: list[Path] = []
    primary = resource_root()
    roots.append(primary)
    if getattr(sys, "frozen", False):
        for candidate in _frozen_resource_candidates():
            if candidate not in roots:
                roots.append(candidate)

    for root in roots:
        try:
            base = root.resolve()
            target = (base / rel).resolve()
            target.relative_to(base)
        except (OSError, ValueError):
            continue
        if target.is_file():
            return target
    return None


RESOURCE_ROOT = _resolve_resource_root()
DATA_DIR = _resolve_data_dir()
# Back-compat alias used by older helpers / docs.
ROOT = RESOURCE_ROOT
CONFIG_PATH = DATA_DIR / "config.json"
WORKSPACE_PATH = DATA_DIR / "workspace.json"
WORKSPACE_LOCK = threading.Lock()

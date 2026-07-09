"""Path helpers for desktop and packaged builds."""

from __future__ import annotations

import os
import sys
from pathlib import Path

from desktop.version import APP_NAME


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def resource_root() -> Path:
    raw = os.environ.get("STOCKAGENT_RESOURCE_DIR")
    if raw:
        return Path(raw).expanduser().resolve()
    if is_frozen() and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS).resolve()
    return repo_root()


def default_data_dir() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_NAME
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or str(Path.home())
        return Path(base) / APP_NAME
    return Path.home() / ".local" / "share" / APP_NAME


def data_dir() -> Path:
    raw = os.environ.get("STOCKAGENT_DATA_DIR")
    path = Path(raw).expanduser().resolve() if raw else default_data_dir()
    path.mkdir(parents=True, exist_ok=True)
    (path / "logs").mkdir(parents=True, exist_ok=True)
    return path


def configure_env(*, desktop: bool = True, data: Path | None = None, resources: Path | None = None) -> Path:
    """Set process env before importing server.py."""
    if desktop:
        os.environ["STOCKAGENT_DESKTOP"] = "1"
    data_path = Path(data).expanduser().resolve() if data else default_data_dir()
    data_path.mkdir(parents=True, exist_ok=True)
    (data_path / "logs").mkdir(parents=True, exist_ok=True)
    os.environ["STOCKAGENT_DATA_DIR"] = str(data_path)
    resource_path = Path(resources).expanduser().resolve() if resources else resource_root()
    os.environ["STOCKAGENT_RESOURCE_DIR"] = str(resource_path)
    return data_path


def maybe_migrate_repo_workspace(data_path: Path) -> None:
    """Copy repo-root workspace/config into the desktop data dir on first launch."""
    root = repo_root()
    mapping = {
        "workspace.json": data_path / "workspace.json",
        "config.json": data_path / "config.json",
        ".catalog-cache.json": data_path / ".catalog-cache.json",
    }
    for name, dest in mapping.items():
        src = root / name
        if dest.exists() or not src.exists():
            continue
        try:
            dest.write_bytes(src.read_bytes())
        except OSError:
            pass

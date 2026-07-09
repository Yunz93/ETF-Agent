# PyInstaller runtime hook for StockAgent desktop builds.
import os
import sys
from pathlib import Path


def _configure() -> None:
    os.environ.setdefault("STOCKAGENT_DESKTOP", "1")
    if getattr(sys, "frozen", False):
        meipass = Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent))
        os.environ.setdefault("STOCKAGENT_RESOURCE_DIR", str(meipass))
        # Prefer Application Support; leave STOCKAGENT_DATA_DIR unset so paths.py chooses.
        os.environ.pop("STOCKAGENT_FORCE_REPO_DATA", None)


_configure()

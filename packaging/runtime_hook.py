# PyInstaller runtime hook for StockAgent desktop builds.
import os
import sys
from pathlib import Path


def _configure() -> None:
    os.environ.setdefault("STOCKAGENT_DESKTOP", "1")
    if getattr(sys, "frozen", False):
        meipass = Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent))
        candidates = [meipass]
        exe_parent = Path(sys.executable).resolve().parent
        contents = exe_parent.parent
        candidates.extend(
            [
                exe_parent,
                contents / "Frameworks",
                contents / "Resources",
            ]
        )
        chosen = meipass
        for candidate in candidates:
            try:
                resolved = candidate.resolve()
            except OSError:
                continue
            if (resolved / "index.html").is_file():
                chosen = resolved
                break
        os.environ["STOCKAGENT_RESOURCE_DIR"] = str(chosen.resolve())
        # Prefer Application Support; leave STOCKAGENT_DATA_DIR unset so paths.py chooses.
        os.environ.pop("STOCKAGENT_FORCE_REPO_DATA", None)


_configure()

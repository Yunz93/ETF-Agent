#!/usr/bin/env python3
"""Smoke-test the Vercel serverless entry module."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


class VercelEntrypointTests(unittest.TestCase):
    def test_handler_exports_under_tmp_data_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp) / "stockagent-data"
            env = os.environ.copy()
            env["STOCKAGENT_DATA_DIR"] = str(data_dir)
            env["STOCKAGENT_RESOURCE_DIR"] = str(ROOT)
            for key in (
                "BLOB_READ_WRITE_TOKEN",
                "BLOB_STORE_ID",
                "VERCEL_OIDC_TOKEN",
                "STOCKAGENT_EPHEMERAL",
            ):
                env.pop(key, None)
            env["PYTHONPATH"] = os.pathsep.join(
                [str(ROOT)] + ([env["PYTHONPATH"]] if env.get("PYTHONPATH") else [])
            )
            script = """
import os
import api.index as mod
from pathlib import Path
from stockagent.paths import DATA_DIR, RESOURCE_ROOT
from stockagent.health import get_runtime_info, is_ephemeral_storage
assert hasattr(mod, "handler")
assert issubclass(mod.handler, mod.Handler)
assert Path(DATA_DIR) == Path(%r).resolve()
assert Path(RESOURCE_ROOT) == Path(%r).resolve()
assert (RESOURCE_ROOT / "index.html").is_file()
# Without Blob credentials, Vercel entry marks storage ephemeral.
assert os.environ.get("STOCKAGENT_EPHEMERAL") == "1"
assert is_ephemeral_storage() is True
info = get_runtime_info()
assert info.get("ephemeral_storage") is True
assert info.get("durable_storage") == "local"
""" % (
                str(data_dir),
                str(ROOT),
            )
            completed = subprocess.run(
                [sys.executable, "-c", script],
                cwd=str(ROOT),
                env=env,
                capture_output=True,
                text=True,
            )
            if completed.returncode != 0:
                self.fail(completed.stderr or completed.stdout or "import failed")


if __name__ == "__main__":
    unittest.main()

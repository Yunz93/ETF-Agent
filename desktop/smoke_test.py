#!/usr/bin/env python3
"""Headless smoke test for the desktop server bootstrap (no GUI)."""

from __future__ import annotations

import json
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from desktop.paths import configure_env  # noqa: E402


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="stockagent-desktop-") as tmp:
        data = Path(tmp)
        configure_env(desktop=True, data=data, resources=ROOT)
        import server as stock_server

        httpd = stock_server.create_server(host="127.0.0.1", port=0, dual_stack=False)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        port = httpd.server_address[1]
        base = f"http://127.0.0.1:{port}"
        try:
            deadline = time.time() + 10
            runtime = None
            while time.time() < deadline:
                try:
                    with urllib.request.urlopen(f"{base}/api/runtime", timeout=2) as response:
                        runtime = json.loads(response.read().decode("utf-8"))
                    break
                except Exception:
                    time.sleep(0.1)
            assert runtime, "runtime endpoint unavailable"
            assert runtime["mode"] == "desktop"
            assert Path(runtime["data_dir"]) == data.resolve()
            with urllib.request.urlopen(f"{base}/index.html", timeout=3) as response:
                html = response.read().decode("utf-8", errors="replace")
            assert "StockAgent" in html
            print("desktop smoke ok", json.dumps({"port": port, "data_dir": runtime["data_dir"]}))
            return 0
        finally:
            httpd.shutdown()


if __name__ == "__main__":
    raise SystemExit(main())

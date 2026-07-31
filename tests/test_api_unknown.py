#!/usr/bin/env python3
"""Unknown /api/* routes must return JSON, not HTML."""

from __future__ import annotations

import json
import sys
import threading
import urllib.error
import urllib.request
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from stockagent.handler import Handler  # noqa: E402


class UnknownApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def test_unknown_api_returns_json_404(self):
        url = f"http://127.0.0.1:{self.port}/api/does-not-exist"
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(url, timeout=5)
        error = ctx.exception
        self.assertEqual(error.code, 404)
        body = error.read().decode("utf-8")
        self.assertFalse(body.lstrip().startswith("<!DOCTYPE"))
        payload = json.loads(body)
        self.assertIn("error", payload)

    def test_market_sentiment_route_returns_json(self):
        url = f"http://127.0.0.1:{self.port}/api/market/sentiment?markets=A"
        with urllib.request.urlopen(url, timeout=60) as response:
            body = response.read().decode("utf-8")
        self.assertFalse(body.lstrip().startswith("<"))
        payload = json.loads(body)
        self.assertIn("items", payload)


if __name__ == "__main__":
    unittest.main()

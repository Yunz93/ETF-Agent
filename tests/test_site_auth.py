#!/usr/bin/env python3
"""SITE_PASSWORD gate: HMAC cookie, login/logout, disabled-when-unset."""

from __future__ import annotations

import json
import os
import sys
import threading
import unittest
import urllib.error
import urllib.request
from http.cookiejar import CookieJar
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from stockagent import site_auth  # noqa: E402
from stockagent.handler import Handler  # noqa: E402


class SiteAuthUnitTests(unittest.TestCase):
    def tearDown(self):
        os.environ.pop("SITE_PASSWORD", None)

    def test_disabled_when_unset(self):
        os.environ.pop("SITE_PASSWORD", None)
        self.assertFalse(site_auth.auth_enabled())
        self.assertTrue(site_auth.cookie_ok({"Cookie": ""}))
        self.assertTrue(site_auth.login_ok("anything"))

    def test_token_stable_and_rejects_wrong_password(self):
        os.environ["SITE_PASSWORD"] = "secret-a"
        token_a = site_auth.session_token()
        self.assertEqual(token_a, site_auth.session_token("secret-a"))
        self.assertNotEqual(token_a, site_auth.session_token("secret-b"))
        self.assertTrue(site_auth.login_ok("secret-a"))
        self.assertFalse(site_auth.login_ok("secret-b"))
        self.assertFalse(site_auth.login_ok(""))

    def test_cookie_ok_requires_matching_token(self):
        os.environ["SITE_PASSWORD"] = "gate"
        token = site_auth.session_token()
        self.assertTrue(site_auth.cookie_ok({"Cookie": f"{site_auth.COOKIE_NAME}={token}"}))
        self.assertFalse(site_auth.cookie_ok({"Cookie": f"{site_auth.COOKIE_NAME}=deadbeef"}))
        self.assertFalse(site_auth.cookie_ok({"Cookie": ""}))

    def test_public_paths(self):
        self.assertTrue(site_auth.is_public_path("/login"))
        self.assertTrue(site_auth.is_public_path("/api/auth/login"))
        self.assertTrue(site_auth.is_public_path("/api/ready"))
        self.assertFalse(site_auth.is_public_path("/api/workspace"))
        self.assertFalse(site_auth.is_public_path("/"))

    def test_login_page_contains_form(self):
        page = site_auth.login_page_html("口令错误")
        self.assertIn("访问口令", page)
        self.assertIn("口令错误", page)
        self.assertIn("/api/auth/login", page)


class SiteAuthHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def tearDown(self):
        os.environ.pop("SITE_PASSWORD", None)

    def _opener(self):
        return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))

    def test_no_password_api_open(self):
        os.environ.pop("SITE_PASSWORD", None)
        with urllib.request.urlopen(f"{self.base}/api/ready", timeout=5) as response:
            payload = json.loads(response.read().decode("utf-8"))
        self.assertTrue(payload.get("ready"))

    def test_password_blocks_api_without_cookie(self):
        os.environ["SITE_PASSWORD"] = "test-pass"
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(f"{self.base}/api/runtime", timeout=5)
        self.assertEqual(ctx.exception.code, 401)
        body = json.loads(ctx.exception.read().decode("utf-8"))
        self.assertEqual(body.get("error"), "未登录")

    def test_ready_stays_public(self):
        os.environ["SITE_PASSWORD"] = "test-pass"
        with urllib.request.urlopen(f"{self.base}/api/ready", timeout=5) as response:
            payload = json.loads(response.read().decode("utf-8"))
        self.assertTrue(payload.get("ready"))

    def test_wrong_password_rejected(self):
        os.environ["SITE_PASSWORD"] = "test-pass"
        req = urllib.request.Request(
            f"{self.base}/api/auth/login",
            data=json.dumps({"password": "nope"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req, timeout=5)
        self.assertEqual(ctx.exception.code, 401)

    def test_login_sets_cookie_and_unlocks(self):
        os.environ["SITE_PASSWORD"] = "test-pass"
        opener = self._opener()
        req = urllib.request.Request(
            f"{self.base}/api/auth/login",
            data=json.dumps({"password": "test-pass"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with opener.open(req, timeout=5) as response:
            payload = json.loads(response.read().decode("utf-8"))
            set_cookie = response.headers.get("Set-Cookie") or ""
        self.assertTrue(payload.get("ok"))
        self.assertIn(site_auth.COOKIE_NAME, set_cookie)
        with opener.open(f"{self.base}/api/runtime", timeout=5) as response:
            runtime = json.loads(response.read().decode("utf-8"))
        self.assertIn("app", runtime)

    def test_html_unauthenticated_gets_login_page(self):
        os.environ["SITE_PASSWORD"] = "test-pass"
        with urllib.request.urlopen(f"{self.base}/", timeout=5) as response:
            body = response.read().decode("utf-8")
        self.assertIn("访问口令", body)
        self.assertIn("<form", body)

    def test_login_page_route(self):
        os.environ["SITE_PASSWORD"] = "test-pass"
        with urllib.request.urlopen(f"{self.base}/login", timeout=5) as response:
            body = response.read().decode("utf-8")
        self.assertIn("ETF Agent", body)


if __name__ == "__main__":
    unittest.main()

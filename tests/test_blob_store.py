#!/usr/bin/env python3
"""Unit tests for Vercel Blob JSON helpers (mocked HTTP)."""

from __future__ import annotations

import io
import json
import os
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

from stockagent import blob_store
from stockagent import health
from stockagent import workspace_store


class FakeResponse:
    def __init__(self, payload, status=200):
        if isinstance(payload, (dict, list)):
            raw = json.dumps(payload).encode("utf-8")
        elif isinstance(payload, str):
            raw = payload.encode("utf-8")
        else:
            raw = payload or b""
        self._buf = io.BytesIO(raw)
        self.status = status

    def read(self):
        return self._buf.read()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class BlobStoreTests(unittest.TestCase):
    def setUp(self):
        blob_store.reset_hydration_for_tests()
        self.env = {
            "BLOB_READ_WRITE_TOKEN": "vercel_blob_rw_AbCdEfGh_secretpart",
            "STOCKAGENT_BLOB_ACCESS": "private",
        }

    def test_parse_store_id(self):
        self.assertEqual(
            blob_store.parse_store_id("vercel_blob_rw_AbCdEfGh_secretpart"),
            "AbCdEfGh",
        )

    def test_blob_enabled(self):
        with mock.patch.dict(os.environ, {"BLOB_READ_WRITE_TOKEN": ""}, clear=False):
            os.environ.pop("BLOB_READ_WRITE_TOKEN", None)
            self.assertFalse(blob_store.blob_enabled())
        with mock.patch.dict(os.environ, self.env, clear=False):
            self.assertTrue(blob_store.blob_enabled())

    def test_put_json_issues_overwrite_put(self):
        captured = {}

        def fake_urlopen(request, timeout=30):
            captured["url"] = request.full_url
            captured["method"] = request.get_method()
            captured["headers"] = {k.lower(): v for k, v in request.header_items()}
            captured["body"] = request.data
            return FakeResponse({"url": "https://example/blob", "pathname": "stockagent/workspace.json"})

        with mock.patch.dict(os.environ, self.env, clear=False):
            with mock.patch("urllib.request.urlopen", side_effect=fake_urlopen):
                result = blob_store.put_json("stockagent/workspace.json", {"etfs": []})
        self.assertEqual(result["pathname"], "stockagent/workspace.json")
        self.assertEqual(captured["method"], "PUT")
        self.assertIn("pathname=stockagent%2Fworkspace.json", captured["url"])
        self.assertEqual(captured["headers"]["x-allow-overwrite"], "1")
        self.assertEqual(captured["headers"]["x-add-random-suffix"], "0")
        self.assertEqual(captured["headers"]["x-vercel-blob-access"], "private")
        self.assertEqual(captured["headers"]["x-vercel-blob-store-id"], "AbCdEfGh")
        self.assertIn(b'"etfs"', captured["body"])

    def test_get_json_404_returns_none(self):
        def fake_urlopen(request, timeout=30):
            raise urllib.error.HTTPError(request.full_url, 404, "Not Found", hdrs=None, fp=None)

        with mock.patch.dict(os.environ, self.env, clear=False):
            with mock.patch("urllib.request.urlopen", side_effect=fake_urlopen):
                self.assertIsNone(blob_store.get_json("stockagent/workspace.json"))

    def test_hydrate_writes_local_from_remote(self):
        remote = {"version": 8, "etfs": [{"symbol": "512890"}], "updated_at": "2026-08-05T00:00:00.000Z"}

        def fake_urlopen(request, timeout=30):
            return FakeResponse(remote)

        with tempfile.TemporaryDirectory() as tmp:
            local = Path(tmp) / "workspace.json"
            with mock.patch.dict(os.environ, self.env, clear=False):
                with mock.patch("urllib.request.urlopen", side_effect=fake_urlopen):
                    loaded = blob_store.hydrate_local_json("stockagent/workspace.json", local)
            self.assertEqual(loaded["etfs"][0]["symbol"], "512890")
            self.assertTrue(local.exists())
            self.assertEqual(json.loads(local.read_text())["etfs"][0]["symbol"], "512890")

    def test_save_workspace_persists_to_blob_when_enabled(self):
        puts = []

        def fake_persist(pathname, payload):
            puts.append((pathname, payload))

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "workspace.json"
            with mock.patch.object(workspace_store, "WORKSPACE_PATH", path):
                with mock.patch(
                    "stockagent.blob_store.persist_json",
                    side_effect=fake_persist,
                ):
                    with mock.patch("stockagent.blob_store.blob_enabled", return_value=True):
                        saved = workspace_store.save_workspace(
                            {
                                "etfs": [
                                    {
                                        "symbol": "512890",
                                        "name": "红利",
                                        "shares": 0,
                                        "cost": 0,
                                    }
                                ],
                                "buys": [],
                                "sells": [],
                                "plan": {},
                            }
                        )
            self.assertTrue(path.exists())
        self.assertEqual(len(puts), 1)
        self.assertEqual(puts[0][0], "stockagent/workspace.json")
        self.assertEqual(puts[0][1]["etfs"][0]["symbol"], "512890")
        self.assertEqual(saved["etfs"][0]["symbol"], "512890")

    def test_runtime_not_ephemeral_when_blob_enabled(self):
        with mock.patch.dict(os.environ, self.env, clear=False):
            self.assertEqual(health.durable_storage_backend(), "blob")
            self.assertFalse(health.is_ephemeral_storage())
            info = health.get_runtime_info()
            self.assertEqual(info["durable_storage"], "blob")
            self.assertFalse(info["ephemeral_storage"])


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Runtime ephemeral_storage flag for serverless hosts."""

from __future__ import annotations

import os
import unittest
from pathlib import Path
from unittest import mock

from stockagent import health


_BLOB_KEYS = ("BLOB_READ_WRITE_TOKEN", "BLOB_STORE_ID", "VERCEL_OIDC_TOKEN")


class EphemeralRuntimeTests(unittest.TestCase):
    def test_env_flag_forces_ephemeral_without_blob(self):
        env = {k: v for k, v in os.environ.items() if k not in _BLOB_KEYS}
        env["STOCKAGENT_EPHEMERAL"] = "1"
        with mock.patch.dict(os.environ, env, clear=True):
            self.assertTrue(health.is_ephemeral_storage())

    def test_blob_token_disables_ephemeral(self):
        with mock.patch.dict(
            os.environ,
            {
                "STOCKAGENT_EPHEMERAL": "1",
                "BLOB_READ_WRITE_TOKEN": "vercel_blob_rw_StoreIdX_secret",
            },
            clear=False,
        ):
            self.assertFalse(health.is_ephemeral_storage())

    def test_blob_store_id_disables_ephemeral(self):
        env = {k: v for k, v in os.environ.items() if k not in _BLOB_KEYS}
        env["STOCKAGENT_EPHEMERAL"] = "1"
        env["BLOB_STORE_ID"] = "store_AbCdEfGh"
        with mock.patch.dict(os.environ, env, clear=True):
            self.assertFalse(health.is_ephemeral_storage())
            info = health.get_runtime_info()
            self.assertEqual(info["durable_storage"], "blob")
            self.assertEqual(info["blob_auth"], "oidc")

    def test_env_flag_disables_ephemeral(self):
        env = {k: v for k, v in os.environ.items() if k not in _BLOB_KEYS}
        env["STOCKAGENT_EPHEMERAL"] = "0"
        with mock.patch.dict(os.environ, env, clear=True):
            with mock.patch.object(health, "DATA_DIR", Path("/tmp/stockagent")):
                self.assertFalse(health.is_ephemeral_storage())

    def test_tmp_data_dir_is_ephemeral_without_blob(self):
        env = {
            k: v
            for k, v in os.environ.items()
            if k not in {"STOCKAGENT_EPHEMERAL", *_BLOB_KEYS}
        }
        with mock.patch.dict(os.environ, env, clear=True):
            with mock.patch.object(health, "DATA_DIR", Path("/tmp/stockagent")):
                self.assertTrue(health.is_ephemeral_storage())

    def test_repo_data_dir_is_durable_without_flag(self):
        env = {
            k: v
            for k, v in os.environ.items()
            if k not in {"STOCKAGENT_EPHEMERAL", *_BLOB_KEYS}
        }
        with mock.patch.dict(os.environ, env, clear=True):
            with mock.patch.object(health, "DATA_DIR", Path("/workspace/data")):
                self.assertFalse(health.is_ephemeral_storage())

    def test_runtime_info_includes_durable_flag(self):
        env = {k: v for k, v in os.environ.items() if k not in _BLOB_KEYS}
        env["STOCKAGENT_EPHEMERAL"] = "1"
        with mock.patch.dict(os.environ, env, clear=True):
            info = health.get_runtime_info()
        self.assertIn("ephemeral_storage", info)
        self.assertIn("durable_storage", info)
        self.assertTrue(info["ephemeral_storage"])
        self.assertEqual(info["durable_storage"], "local")
        self.assertIsNone(info.get("blob_auth"))


if __name__ == "__main__":
    unittest.main()

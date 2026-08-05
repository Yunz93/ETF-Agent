#!/usr/bin/env python3
"""Runtime ephemeral_storage flag for serverless hosts."""

from __future__ import annotations

import os
import unittest
from pathlib import Path
from unittest import mock

from stockagent import health


class EphemeralRuntimeTests(unittest.TestCase):
    def test_env_flag_forces_ephemeral(self):
        with mock.patch.dict(os.environ, {"STOCKAGENT_EPHEMERAL": "1"}, clear=False):
            self.assertTrue(health.is_ephemeral_storage())

    def test_env_flag_disables_ephemeral(self):
        with mock.patch.dict(os.environ, {"STOCKAGENT_EPHEMERAL": "0"}, clear=False):
            with mock.patch.object(health, "DATA_DIR", Path("/tmp/stockagent")):
                self.assertFalse(health.is_ephemeral_storage())

    def test_tmp_data_dir_is_ephemeral_without_flag(self):
        env = {k: v for k, v in os.environ.items() if k != "STOCKAGENT_EPHEMERAL"}
        with mock.patch.dict(os.environ, env, clear=True):
            with mock.patch.object(health, "DATA_DIR", Path("/tmp/stockagent")):
                self.assertTrue(health.is_ephemeral_storage())

    def test_repo_data_dir_is_durable_without_flag(self):
        env = {k: v for k, v in os.environ.items() if k != "STOCKAGENT_EPHEMERAL"}
        with mock.patch.dict(os.environ, env, clear=True):
            with mock.patch.object(health, "DATA_DIR", Path("/workspace/data")):
                self.assertFalse(health.is_ephemeral_storage())

    def test_runtime_info_includes_flag(self):
        with mock.patch.dict(os.environ, {"STOCKAGENT_EPHEMERAL": "1"}, clear=False):
            info = health.get_runtime_info()
        self.assertIn("ephemeral_storage", info)
        self.assertTrue(info["ephemeral_storage"])


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Vercel Python serverless entrypoint for ETF Agent.

All traffic is routed here (see vercel.json ``routes``) so SITE_PASSWORD can
gate both HTML and ``/api/*``. Writable state goes under ``/tmp`` because the
Vercel function filesystem is read-only outside of it.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Must run before importing stockagent.paths (DATA_DIR is resolved at import).
os.environ.setdefault("STOCKAGENT_DATA_DIR", "/tmp/stockagent")
os.environ.setdefault("STOCKAGENT_RESOURCE_DIR", str(Path(__file__).resolve().parent.parent))
# /tmp is only a warm cache. Durable persistence requires a connected Vercel
# Blob store (BLOB_READ_WRITE_TOKEN and/or BLOB_STORE_ID + runtime OIDC).
if os.environ.get("BLOB_READ_WRITE_TOKEN", "").strip() or os.environ.get(
    "BLOB_STORE_ID", ""
).strip():
    os.environ["STOCKAGENT_EPHEMERAL"] = "0"
else:
    os.environ.setdefault("STOCKAGENT_EPHEMERAL", "1")

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from stockagent.config_store import load_config  # noqa: E402
from stockagent.handler import Handler  # noqa: E402

load_config()


class handler(Handler):
    """Vercel looks for a BaseHTTPRequestHandler subclass named ``handler``."""

    def log_message(self, fmt, *args):
        # Keep function logs compact on Vercel.
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

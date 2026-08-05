#!/usr/bin/env python3
"""Vercel Blob JSON persistence (stdlib HTTP, no SDK).

When ``BLOB_READ_WRITE_TOKEN`` is set, workspace/config are stored under fixed
pathnames in the connected Blob store so serverless ``/tmp`` cold starts do not
lose data. Local files under ``DATA_DIR`` remain a warm-instance cache.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

BLOB_API_URL = os.environ.get("VERCEL_BLOB_API_URL", "https://vercel.com/api/blob").rstrip("/")
BLOB_API_VERSION = os.environ.get("VERCEL_BLOB_API_VERSION_OVERRIDE") or "12"

WORKSPACE_BLOB_PATH = "stockagent/workspace.json"
CONFIG_BLOB_PATH = "stockagent/config.json"

_hydrated: dict[str, bool] = {
    WORKSPACE_BLOB_PATH: False,
    CONFIG_BLOB_PATH: False,
}


def blob_enabled() -> bool:
    return bool(os.environ.get("BLOB_READ_WRITE_TOKEN", "").strip())


def blob_access() -> str:
    raw = os.environ.get("STOCKAGENT_BLOB_ACCESS", "private").strip().lower()
    return "public" if raw == "public" else "private"


def parse_store_id(token: str | None = None) -> str:
    value = (token if token is not None else os.environ.get("BLOB_READ_WRITE_TOKEN", "")).strip()
    # vercel_blob_rw_<STOREID>_<SECRET>
    parts = value.split("_")
    return parts[3] if len(parts) >= 5 else ""


def reset_hydration_for_tests() -> None:
    for key in _hydrated:
        _hydrated[key] = False


def _token() -> str:
    token = os.environ.get("BLOB_READ_WRITE_TOKEN", "").strip()
    if not token:
        raise RuntimeError("BLOB_READ_WRITE_TOKEN is not configured")
    return token


def _headers_for_put(store_id: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {_token()}",
        "x-api-version": str(BLOB_API_VERSION),
        "x-vercel-blob-access": blob_access(),
        "x-content-type": "application/json; charset=utf-8",
        "x-add-random-suffix": "0",
        "x-allow-overwrite": "1",
        "x-vercel-blob-store-id": store_id,
        "User-Agent": "ETF-Agent/blob-store",
    }


def put_json(pathname: str, payload: Any, timeout: float = 30) -> dict:
    """Upload JSON to a fixed Blob pathname (overwrite in place)."""
    store_id = parse_store_id()
    if not store_id:
        raise RuntimeError("Unable to parse store id from BLOB_READ_WRITE_TOKEN")
    body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"
    query = urllib.parse.urlencode({"pathname": pathname})
    request = urllib.request.Request(
        f"{BLOB_API_URL}/?{query}",
        data=body,
        method="PUT",
        headers=_headers_for_put(store_id),
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read().decode("utf-8", errors="replace")
    return json.loads(raw) if raw.strip() else {}


def get_json(pathname: str, timeout: float = 30) -> Any | None:
    """Fetch JSON from Blob. Returns None when the object does not exist."""
    store_id = parse_store_id()
    if not store_id:
        raise RuntimeError("Unable to parse store id from BLOB_READ_WRITE_TOKEN")
    access = blob_access()
    url = f"https://{store_id}.{access}.blob.vercel-storage.com/{pathname}?cache=0"
    request = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {_token()}",
            "Accept": "application/json",
            "User-Agent": "ETF-Agent/blob-store",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise
    if not raw.strip():
        return None
    return json.loads(raw)


def persist_json(pathname: str, payload: Any) -> None:
    """Best-effort no-op when Blob is not configured; otherwise upload."""
    if not blob_enabled():
        return
    put_json(pathname, payload)
    _hydrated[pathname] = True


def hydrate_local_json(pathname: str, local_path, *, migrate_local: bool = True) -> Any | None:
    """Pull Blob → local file once per process; optionally migrate local → Blob."""
    if not blob_enabled():
        _hydrated[pathname] = True
        return None
    if _hydrated.get(pathname):
        return None
    remote = get_json(pathname)
    if remote is not None:
        local_path.parent.mkdir(parents=True, exist_ok=True)
        local_path.write_text(
            json.dumps(remote, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        _hydrated[pathname] = True
        return remote
    if migrate_local and local_path.exists():
        try:
            local_payload = json.loads(local_path.read_text(encoding="utf-8"))
            put_json(pathname, local_payload)
        except Exception:
            pass
    _hydrated[pathname] = True
    return None

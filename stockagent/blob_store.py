#!/usr/bin/env python3
"""Vercel Blob JSON persistence (stdlib HTTP, no SDK).

Supports both credential styles Vercel injects for connected Blob stores:

- ``BLOB_READ_WRITE_TOKEN`` (long-lived read-write token)
- ``BLOB_STORE_ID`` + runtime ``VERCEL_OIDC_TOKEN`` (OIDC; default for new stores)

Workspace/config are stored under fixed pathnames so serverless ``/tmp`` cold
starts do not lose data. Local files under ``DATA_DIR`` remain a warm cache.
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


class BlobHydrateError(RuntimeError):
    """Raised when Blob is configured but remote hydrate fails (non-404)."""


_hydrated: dict[str, bool] = {
    WORKSPACE_BLOB_PATH: False,
    CONFIG_BLOB_PATH: False,
}


def normalize_store_id(raw: str) -> str:
    value = str(raw or "").strip()
    if value.startswith("store_"):
        return value[len("store_") :]
    return value


def parse_store_id_from_read_write_token(token: str) -> str:
    # vercel_blob_rw_<STOREID>_<SECRET>
    parts = str(token or "").strip().split("_")
    return parts[3] if len(parts) >= 5 else ""


def blob_store_configured() -> bool:
    """True when the project has Blob credentials wired (token and/or store id)."""
    if os.environ.get("BLOB_READ_WRITE_TOKEN", "").strip():
        return True
    if os.environ.get("BLOB_STORE_ID", "").strip():
        return True
    return False


def blob_enabled() -> bool:
    """True when durable Blob backend should be used.

    On Vercel, ``BLOB_STORE_ID`` is present even before the short-lived
    ``VERCEL_OIDC_TOKEN`` is attached to a request; treat that as enabled so
    ``/api/runtime`` reports durable storage correctly.
    """
    return blob_store_configured()


def blob_access() -> str:
    raw = os.environ.get("STOCKAGENT_BLOB_ACCESS", "private").strip().lower()
    return "public" if raw == "public" else "private"


def resolve_blob_auth() -> dict[str, str]:
    """Return ``{kind, token, store_id}`` or raise if credentials are incomplete."""
    read_write = os.environ.get("BLOB_READ_WRITE_TOKEN", "").strip()
    if read_write:
        store_id = parse_store_id_from_read_write_token(read_write)
        if not store_id:
            raise RuntimeError("Unable to parse store id from BLOB_READ_WRITE_TOKEN")
        return {"kind": "read_write", "token": read_write, "store_id": store_id}

    store_id = normalize_store_id(os.environ.get("BLOB_STORE_ID", ""))
    oidc = os.environ.get("VERCEL_OIDC_TOKEN", "").strip()
    if store_id and oidc:
        return {"kind": "oidc", "token": oidc, "store_id": store_id}
    if store_id and not oidc:
        raise RuntimeError(
            "BLOB_STORE_ID is set but VERCEL_OIDC_TOKEN is missing "
            "(OIDC token is injected automatically on Vercel runtimes)"
        )
    raise RuntimeError(
        "No Blob credentials found. Set BLOB_READ_WRITE_TOKEN, or connect a "
        "Blob store so BLOB_STORE_ID + VERCEL_OIDC_TOKEN are available."
    )


def blob_auth_kind() -> str | None:
    """Best-effort auth mode for runtime diagnostics (does not require OIDC yet)."""
    if os.environ.get("BLOB_READ_WRITE_TOKEN", "").strip():
        return "read_write"
    if os.environ.get("BLOB_STORE_ID", "").strip():
        return "oidc"
    return None


# Back-compat alias used by older tests/helpers.
def parse_store_id(token: str | None = None) -> str:
    if token is not None:
        return parse_store_id_from_read_write_token(token)
    try:
        return resolve_blob_auth()["store_id"]
    except Exception:
        return normalize_store_id(os.environ.get("BLOB_STORE_ID", ""))


def reset_hydration_for_tests() -> None:
    for key in _hydrated:
        _hydrated[key] = False


def _headers_for_put(auth: dict[str, str]) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {auth['token']}",
        "x-api-version": str(BLOB_API_VERSION),
        "x-vercel-blob-access": blob_access(),
        "x-content-type": "application/json; charset=utf-8",
        "x-add-random-suffix": "0",
        "x-allow-overwrite": "1",
        "x-vercel-blob-store-id": auth["store_id"],
        "User-Agent": "ETF-Agent/blob-store",
    }


def put_json(pathname: str, payload: Any, timeout: float = 30) -> dict:
    """Upload JSON to a fixed Blob pathname (overwrite in place)."""
    auth = resolve_blob_auth()
    body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"
    query = urllib.parse.urlencode({"pathname": pathname})
    request = urllib.request.Request(
        f"{BLOB_API_URL}/?{query}",
        data=body,
        method="PUT",
        headers=_headers_for_put(auth),
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read().decode("utf-8", errors="replace")
    return json.loads(raw) if raw.strip() else {}


def get_json(pathname: str, timeout: float = 30) -> Any | None:
    """Fetch JSON from Blob. Returns None when the object does not exist."""
    auth = resolve_blob_auth()
    access = blob_access()
    url = f"https://{auth['store_id']}.{access}.blob.vercel-storage.com/{pathname}?cache=0"
    request = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {auth['token']}",
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
    """Pull Blob → local file once per process; optionally migrate local → Blob.

    404 / missing remote is normal (first deploy). Transport or 5xx errors raise
    ``BlobHydrateError`` so callers do not seed defaults and overwrite durable data.
    """
    if not blob_enabled():
        _hydrated[pathname] = True
        return None
    if _hydrated.get(pathname):
        return None
    try:
        remote = get_json(pathname)
    except Exception as exc:
        raise BlobHydrateError(f"blob hydrate failed for {pathname}: {exc}") from exc
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

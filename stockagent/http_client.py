#!/usr/bin/env python3
"""Small HTTP helpers for JSON/text/bytes requests."""

import json
import urllib.request

from .defaults import YAHOO_UA

def http_get_bytes(url, headers=None, timeout=45):
    request = urllib.request.Request(
        url,
        headers=headers
        or {
            "User-Agent": YAHOO_UA,
            "Accept": "*/*",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def http_get_text(url, headers=None, timeout=45, encoding="utf-8"):
    return http_get_bytes(url, headers=headers, timeout=timeout).decode(encoding, errors="replace")


def http_get_json(url, headers=None, timeout=45):
    return json.loads(http_get_text(url, headers=headers, timeout=timeout))

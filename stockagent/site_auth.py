"""Optional site-wide password gate via SITE_PASSWORD + HMAC cookie.

When SITE_PASSWORD is unset/empty, auth is disabled (local/desktop default).
When set, requests need a valid HttpOnly session cookie unless the path is public.
"""

from __future__ import annotations

import hmac
import hashlib
import html
import os
from http.cookies import SimpleCookie

COOKIE_NAME = "stockagent_session"
COOKIE_MAX_AGE = 30 * 24 * 60 * 60  # 30 days
_TOKEN_MSG = b"stockagent-auth-v1"

PUBLIC_PATHS = frozenset(
    {
        "/login",
        "/api/auth/login",
        "/api/auth/logout",
        "/api/ready",
    }
)


def site_password() -> str:
    return str(os.environ.get("SITE_PASSWORD") or "").strip()


def auth_enabled() -> bool:
    return bool(site_password())


def session_token(password: str | None = None) -> str:
    secret = (password if password is not None else site_password()).encode("utf-8")
    return hmac.new(secret, _TOKEN_MSG, hashlib.sha256).hexdigest()


def login_ok(password) -> bool:
    expected = site_password()
    if not expected:
        return True
    provided = str(password or "")
    return hmac.compare_digest(provided, expected)


def parse_cookies(header_value: str | None) -> dict[str, str]:
    cookie = SimpleCookie()
    if header_value:
        try:
            cookie.load(header_value)
        except Exception:
            return {}
    return {key: morsel.value for key, morsel in cookie.items()}


def cookie_ok(headers) -> bool:
    if not auth_enabled():
        return True
    raw = ""
    if headers is not None:
        raw = headers.get("Cookie") or headers.get("cookie") or ""
    token = parse_cookies(raw).get(COOKIE_NAME, "")
    if not token:
        return False
    return hmac.compare_digest(token, session_token())


def is_public_path(path: str) -> bool:
    return path in PUBLIC_PATHS


def session_cookie_header(*, secure: bool = False, clear: bool = False) -> str:
    if clear:
        parts = [
            f"{COOKIE_NAME}=",
            "Path=/",
            "HttpOnly",
            "SameSite=Lax",
            "Max-Age=0",
        ]
    else:
        parts = [
            f"{COOKIE_NAME}={session_token()}",
            "Path=/",
            "HttpOnly",
            "SameSite=Lax",
            f"Max-Age={COOKIE_MAX_AGE}",
        ]
    if secure:
        parts.append("Secure")
    return "; ".join(parts)


def request_is_https(handler) -> bool:
    """Best-effort HTTPS detection for Secure cookie flag (Vercel / proxies)."""
    proto = (handler.headers.get("X-Forwarded-Proto") or "").split(",")[0].strip().lower()
    if proto == "https":
        return True
    if getattr(handler, "connection", None) is not None:
        # Local plain HTTP stays False.
        return False
    return False


def login_page_html(error: str | None = None) -> str:
    err = ""
    if error:
        err = f'<p class="err">{html.escape(error)}</p>'
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>登录 · ETF Agent</title>
  <style>
    :root {{ color-scheme: light dark; }}
    body {{
      margin: 0; min-height: 100vh; display: grid; place-items: center;
      font-family: "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", sans-serif;
      background: #0f1419; color: #e7ecf1;
    }}
    form {{
      width: min(360px, calc(100vw - 32px));
      padding: 28px 24px; border-radius: 12px;
      background: #1a222c; border: 1px solid #2a3542;
      box-sizing: border-box;
    }}
    h1 {{ margin: 0 0 6px; font-size: 1.25rem; font-weight: 600; }}
    p.lede {{ margin: 0 0 20px; color: #9aa7b5; font-size: 0.9rem; }}
    label {{ display: block; font-size: 0.85rem; margin-bottom: 6px; color: #c5d0db; }}
    input[type=password] {{
      width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px;
      border: 1px solid #3a4654; background: #0f1419; color: inherit; font-size: 1rem;
    }}
    button {{
      margin-top: 16px; width: 100%; padding: 10px 12px; border: 0; border-radius: 8px;
      background: #3d8bfd; color: #fff; font-size: 1rem; font-weight: 600; cursor: pointer;
    }}
    button:hover {{ background: #2f7aeb; }}
    .err {{ margin: 0 0 12px; color: #ff8e8e; font-size: 0.9rem; }}
  </style>
</head>
<body>
  <form id="login" method="post" action="/api/auth/login">
    <h1>ETF Agent</h1>
    <p class="lede">此站点已开启访问保护，请输入口令。</p>
    {err}
    <label for="password">访问口令</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus />
    <button type="submit">登录</button>
  </form>
  <script>
    document.getElementById("login").addEventListener("submit", async (event) => {{
      event.preventDefault();
      const password = document.getElementById("password").value;
      const res = await fetch("/api/auth/login", {{
        method: "POST",
        headers: {{ "Content-Type": "application/json" }},
        body: JSON.stringify({{ password }}),
      }});
      if (res.ok) {{
        location.href = "/";
        return;
      }}
      let message = "口令错误";
      try {{
        const data = await res.json();
        if (data && data.error) message = data.error;
      }} catch (_) {{}}
      location.href = "/login?error=" + encodeURIComponent(message);
    }});
  </script>
</body>
</html>
"""

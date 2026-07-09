#!/usr/bin/env python3
"""Launch StockAgent as a desktop window (pywebview + local HTTP server)."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
from pathlib import Path

from desktop.paths import configure_env, data_dir, maybe_migrate_repo_workspace, repo_root
from desktop.version import __version__ as APP_VERSION


def _log_dir(data_path: Path | None = None) -> Path:
    base = Path(data_path) if data_path else data_dir()
    path = base / "logs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _write_crash_log(message: str, *, data_path: Path | None = None) -> Path:
    log_path = _log_dir(data_path) / "launch.log"
    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(f"\n===== {stamp} =====\n")
        handle.write(message.rstrip() + "\n")
    return log_path


def _notify_launch_failure(detail: str, log_path: Path | None = None) -> None:
    text = detail.strip()
    if log_path:
        text = f"{text}\n\n日志：{log_path}"
    print(text, file=sys.stderr)
    if sys.platform == "darwin":
        script = (
            f'display alert "StockAgent 启动失败" message {json.dumps(text[:900])} '
            f'as critical buttons {{"好"}} default button 1'
        )
        try:
            subprocess.run(  # noqa: S603
                ["osascript", "-e", script],
                check=False,
                timeout=15,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception:  # noqa: BLE001
            pass


def _wait_for_ready(base: str, timeout: float = 15.0) -> dict:
    """Poll a lightweight endpoint until the local HTTP server accepts requests.

    Do NOT use /api/health here — that route refreshes catalogs and samples quotes
    across markets, and can exceed desktop launch budgets (causing silent quit in
    windowed .app builds). Prefer /api/ready, then fall back to /api/runtime.
    """
    candidates = (
        f"{base.rstrip('/')}/api/ready",
        f"{base.rstrip('/')}/api/runtime",
    )
    deadline = time.time() + timeout
    last_error = None
    while time.time() < deadline:
        for url in candidates:
            try:
                with urllib.request.urlopen(url, timeout=1.5) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                if not isinstance(payload, dict):
                    last_error = RuntimeError(f"unexpected payload from {url}: {payload!r}")
                    continue
                if payload.get("ready") is True or payload.get("app") == "StockAgent":
                    return payload
                last_error = RuntimeError(f"unexpected payload from {url}: {payload!r}")
            except Exception as exc:  # noqa: BLE001 - startup probe
                last_error = exc
        time.sleep(0.1)
    raise RuntimeError(f"本地服务启动超时：{last_error}")


def _open_path(path: Path) -> None:
    path = Path(path)
    if sys.platform == "darwin":
        subprocess.Popen(["open", str(path)])  # noqa: S603
    elif sys.platform == "win32":
        subprocess.Popen(["explorer", str(path)])  # noqa: S603
    else:
        opener = shutil.which("xdg-open")
        if opener:
            subprocess.Popen([opener, str(path)])  # noqa: S603


def _start_server():
    # Import after env is configured so server.py picks up data/resource dirs.
    import server as stock_server

    httpd = stock_server.create_server(host="127.0.0.1", port=0, dual_stack=False)
    thread = threading.Thread(target=httpd.serve_forever, name="stockagent-http", daemon=True)
    thread.start()
    host, port = httpd.server_address[:2]
    return httpd, int(port)


def run(width: int = 1280, height: int = 860, debug: bool = False) -> int:
    data_path = configure_env(desktop=True)
    maybe_migrate_repo_workspace(data_path)
    _write_crash_log(f"launch begin version={APP_VERSION}", data_path=data_path)

    try:
        import webview
    except ImportError:
        message = "缺少 pywebview。请先安装：\n  pip install -r requirements-desktop.txt"
        log_path = _write_crash_log(message, data_path=data_path)
        _notify_launch_failure(message, log_path)
        return 1

    httpd, port = _start_server()
    base = f"http://127.0.0.1:{port}"
    try:
        runtime = _wait_for_ready(base)
    except Exception as exc:
        try:
            httpd.shutdown()
        except Exception:  # noqa: BLE001
            pass
        log_path = _write_crash_log(
            "ready probe failed\n" + "".join(traceback.format_exception(exc)),
            data_path=data_path,
        )
        _notify_launch_failure(f"本地服务未能在时限内就绪。\n{exc}", log_path)
        return 1

    runtime.setdefault("data_dir", str(data_path))
    _write_crash_log(
        f"ready ok port={port} data_dir={runtime.get('data_dir')}",
        data_path=data_path,
    )

    window_holder = {"window": None}

    def on_reload():
        window = window_holder["window"]
        if window:
            window.evaluate_js("window.location.reload()")

    def on_open_data():
        _open_path(Path(runtime.get("data_dir") or data_path))

    def on_about():
        window = window_holder["window"]
        detail = (
            f"StockAgent Desktop {runtime.get('version') or APP_VERSION}\n"
            f"数据目录：{runtime.get('data_dir') or data_path}\n"
            f"模式：{runtime.get('mode') or 'desktop'}"
        )
        if window:
            window.evaluate_js(f"alert({json.dumps(detail)})")

    def on_export():
        window = window_holder["window"]
        if not window:
            return
        try:
            with urllib.request.urlopen(f"{base}/api/workspace", timeout=5) as response:
                payload = response.read()
        except Exception as exc:  # noqa: BLE001
            window.evaluate_js(f"alert({json.dumps('导出失败：' + str(exc))})")
            return
        dest = window.create_file_dialog(
            webview.SAVE_DIALOG,
            directory=str(Path.home()),
            save_filename=f"stockagent-workspace-{time.strftime('%Y%m%d')}.json",
            file_types=("JSON (*.json)",),
        )
        if not dest:
            return
        target = Path(dest if isinstance(dest, str) else dest[0])
        target.write_bytes(payload)

    def on_import():
        window = window_holder["window"]
        if not window:
            return
        selected = window.create_file_dialog(
            webview.OPEN_DIALOG,
            allow_multiple=False,
            file_types=("JSON (*.json)",),
        )
        if not selected:
            return
        source = Path(selected if isinstance(selected, str) else selected[0])
        try:
            body = source.read_bytes()
            req = urllib.request.Request(
                f"{base}/api/workspace",
                data=body,
                method="PUT",
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=8) as response:
                response.read()
            window.evaluate_js("window.location.reload()")
        except Exception as exc:  # noqa: BLE001
            window.evaluate_js(f"alert({json.dumps('导入失败：' + str(exc))})")

    from desktop.menu import build_menu

    menu = build_menu(
        on_reload=on_reload,
        on_open_data=on_open_data,
        on_export=on_export,
        on_import=on_import,
        on_about=on_about,
    )

    window = webview.create_window(
        "StockAgent",
        url=base,
        width=width,
        height=height,
        min_size=(960, 640),
        confirm_close=True,
        text_select=True,
    )
    window_holder["window"] = window

    def _shutdown():
        try:
            httpd.shutdown()
        except Exception:  # noqa: BLE001
            pass

    try:
        webview.start(debug=debug, menu=menu)
    finally:
        _shutdown()
        _write_crash_log("launch end", data_path=data_path)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="StockAgent macOS / desktop shell")
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=860)
    parser.add_argument("--debug", action="store_true", help="Open webview DevTools when supported")
    parser.add_argument(
        "--data-dir",
        type=str,
        default=None,
        help="Override Application Support data directory",
    )
    args = parser.parse_args(argv)
    data_override = Path(args.data_dir) if args.data_dir else None
    if data_override:
        configure_env(desktop=True, data=data_override)
    try:
        return run(width=args.width, height=args.height, debug=args.debug)
    except Exception as exc:  # noqa: BLE001 - last-resort for windowed .app
        data_path = None
        try:
            data_path = data_dir()
        except Exception:  # noqa: BLE001
            pass
        log_path = _write_crash_log(
            "unhandled launch error\n" + "".join(traceback.format_exception(exc)),
            data_path=data_path,
        )
        _notify_launch_failure(f"启动异常：{exc}", log_path)
        return 1


if __name__ == "__main__":
    # Allow `python desktop/bootstrap.py` from repo root.
    root = str(repo_root())
    if root not in sys.path:
        sys.path.insert(0, root)
    raise SystemExit(main())

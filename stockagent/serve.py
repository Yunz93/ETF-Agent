#!/usr/bin/env python3
"""HTTP server construction and serving helpers."""

import socket
from http.server import ThreadingHTTPServer

from .paths import DATA_DIR
from .state import CONFIG
from .config_store import load_config
from .handler import Handler

def create_server(host="127.0.0.1", port=None, dual_stack=False):
    """Create the HTTP server. port=None or 0 picks an ephemeral free port."""
    load_config()
    if port is None:
        configured = int(CONFIG.get("server", {}).get("port", 5174))
        port = configured
    if dual_stack:
        try:
            server = ThreadingHTTPServer(("::", port), Handler)
            if hasattr(server.socket, "setsockopt") and hasattr(socket, "IPV6_V6ONLY"):
                server.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
            return server
        except OSError:
            pass
    server = ThreadingHTTPServer((host, port), Handler)
    server.allow_reuse_address = True
    return server


def serve_forever(host="127.0.0.1", port=None, dual_stack=False):
    server = create_server(host=host, port=port, dual_stack=dual_stack)
    bound_host, bound_port = server.server_address[:2]
    print(f"ETF Agent running at http://127.0.0.1:{bound_port} (bound {bound_host}:{bound_port})", flush=True)
    print(f"data_dir={DATA_DIR}", flush=True)
    server.serve_forever()
    return server

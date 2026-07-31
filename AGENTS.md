# AGENTS.md

## Cursor Cloud specific instructions

### What this is
Single-product repo: **ETF Agent / 指数 ETF 工作台**, a Chinese-language index-ETF research workbench. Backend is a pure Python **standard-library** HTTP server (`server.py` → `stockagent/`); frontend is vanilla JS ES modules (`js/`, `index.html`, `styles.css`) served by that same backend. There is no separate frontend dev server, no bundler, no database (persistence is a gitignored `workspace.json` at the repo root), and no framework.

### Toolchain / dependencies
- Python 3.12 and Node.js are preinstalled and sufficient.
- The backend has **no third-party runtime deps** (`requirements.txt` is a comment-only no-op). JS tests use Node's built-in test runner, so there is **no `npm install`** and no lockfile.
- `requirements-desktop.txt` (pywebview/pyinstaller/pyobjc) is only for the macOS desktop app/build and is **not needed** for browser-mode dev or any tests. The desktop smoke test runs without it.

### Run / test / build (see README.md "本地运行" for canonical commands)
- Run app (the one required service): `python3 server.py` → serves everything on `http://localhost:5174` (binds `0.0.0.0`). Do NOT open `index.html` directly; it must be served by `server.py`.
- Python tests: `python3 -m unittest discover -s tests -v`
- JS tests: `npm run test:js`
- Desktop headless smoke test (matches CI, no GUI/pywebview needed): `python3 -m desktop.smoke_test`
- No linter is configured.
- macOS app build (`packaging/build_mac.sh`) is macOS-only; not runnable here.

### Non-obvious caveats
- External market-data APIs (Tencent/Eastmoney/Danjuan/CSI/Yahoo) are reached at runtime. If the VM has no outbound internet, quotes render as "行情不可用" (data unavailable) — the app intentionally never fakes prices. UI, navigation, and local workspace add/edit still work fully offline, and the unit tests do not require the network.
- Key JSON APIs: `GET/PUT /api/workspace` (persists ETF pool/holdings to `workspace.json`), `GET/POST /api/config` (`config.json`), `GET /api/health`, `GET /api/runtime`, `GET /api/ready`, `GET /api/dividend/daily`, `GET /api/etf/quotes`, `GET /api/history`.

# StockAgent Desktop (macOS)

Local-first desktop shell around the existing Python API + static UI.

## Architecture

- **UI**: existing `index.html` / `app.js` / `styles.css`
- **Backend**: `server.py` bound to `127.0.0.1` on an ephemeral port
- **Shell**: [pywebview](https://pywebview.flowrl.com/) (WKWebView on macOS)
- **Data**: `~/Library/Application Support/StockAgent/`

```
StockAgent.app
  └─ bootstrap
       ├─ start server.py (localhost)
       └─ open native window → http://127.0.0.1:<port>
```

## Development (Mac)

```bash
pip install -r requirements-desktop.txt
python3 -m desktop.bootstrap
```

Optional:

```bash
python3 -m desktop.bootstrap --debug
python3 -m desktop.bootstrap --data-dir /tmp/stockagent-data
```

Headless smoke (no GUI; works on Linux CI):

```bash
python3 -m desktop.smoke_test
```

## Data layout

| Path | Purpose |
|------|---------|
| `~/Library/Application Support/StockAgent/workspace.json` | Watchlist, holdings, notes, prefs |
| `~/Library/Application Support/StockAgent/config.json` | Data-source config |
| `~/Library/Application Support/StockAgent/.catalog-cache.json` | Index constituent cache |
| `~/Library/Application Support/StockAgent/logs/` | Reserved for app logs |

On first desktop launch, if those files are missing, bootstrap copies matching files from the repo root when present.

Browser / `python3 server.py` mode still defaults to the **repo root** for data, unless you set:

```bash
export STOCKAGENT_DATA_DIR=...
export STOCKAGENT_RESOURCE_DIR=...
export STOCKAGENT_DESKTOP=1
```

## Packaging

On a Mac with Python 3.10+:

```bash
chmod +x packaging/build_mac.sh
./packaging/build_mac.sh
open dist/StockAgent.app
```

Phase 1 ships **ad-hoc / unsigned** builds for local use. Gatekeeper may require right-click → Open.

Phase 2 (not in this PR): Developer ID signing + notarization + Sparkle/auto-update.

## Menus

| Menu | Action |
|------|--------|
| 文件 → 刷新行情 | Reload the web UI |
| 文件 → 导出/导入工作区 | Native save/open dialogs around `/api/workspace` |
| 文件 → 打开数据目录 | Reveal Application Support folder |
| 帮助 → 关于 | Runtime / data-dir summary |

## Security

- HTTP server listens on loopback only
- No LAN bind in desktop mode
- Network egress is limited to existing quote / catalog / SEC providers

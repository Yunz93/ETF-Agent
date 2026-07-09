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
python3 -m desktop
```

Optional:

```bash
python3 -m desktop --debug
python3 -m desktop --data-dir /tmp/stockagent-data
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

## Packaging (local Mac)

```bash
chmod +x packaging/build_mac.sh
./packaging/build_mac.sh
open dist/StockAgent.app
```

Outputs:

- `dist/StockAgent.app`
- `dist/artifacts/StockAgent-<version>+<build>-macos-<arch>.zip`
- `dist/artifacts/StockAgent-<version>+<build>-macos-<arch>.dmg`
- `dist/artifacts/build-info.json`

Supporting files:

| File | Role |
|------|------|
| `desktop/version.py` | App version / bundle id |
| `packaging/stockagent.spec` | PyInstaller bundle definition |
| `packaging/runtime_hook.py` | Sets desktop env inside frozen app |
| `packaging/entitlements.plist` | Network + user-selected file access |
| `packaging/generate_icons.py` | Builds iconset / `.icns` |
| `packaging/build_mac.sh` | Install → icons → PyInstaller → sign → zip/dmg |

Phase 1 ships **ad-hoc signed** builds. Gatekeeper may still require right-click → Open on other Macs.

Phase 2 (later): Developer ID signing + Apple notarization + Sparkle/auto-update.

## GitHub Actions

Workflow: [`.github/workflows/build-macos.yml`](../.github/workflows/build-macos.yml)

Triggers:

- Push / PR touching desktop, packaging, server, UI, or requirements
- Tags `v*`
- Manual `workflow_dispatch`

Jobs:

1. **Linux smoke** — `python -m desktop.smoke_test` + icon generation
2. **macOS build** — `./packaging/build_mac.sh` on `macos-14`, uploads zip/dmg artifacts

Tagged releases (`v0.1.0` etc.) also publish the artifacts to a GitHub Release.

Download artifacts from the Actions run summary, or from the Release page for tags.

## Menus

| Menu | Action |
|------|--------|
| 文件 → 刷新行情 | Reload the web UI |
| 文件 → 导出/导入工作区 | Native save/open dialogs around `/api/workspace` |
| 文件 → 打开数据目录 | Reveal Application Support folder |
| 帮助 → 关于 | Version / data-dir summary |

## Security

- HTTP server listens on loopback only
- No LAN bind in desktop mode
- Network egress is limited to existing quote / catalog / SEC providers
- Entitlements request only client/server network + user-selected files

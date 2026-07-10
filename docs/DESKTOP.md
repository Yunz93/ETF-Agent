# StockAgent Desktop (macOS)

Local-first desktop shell around the existing Python API + static UI.

## Architecture

- **UI**: existing `index.html` / `js/main.js` ES modules / `styles.css`
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
| `~/Library/Application Support/StockAgent/logs/launch.log` | Desktop launch / crash diagnostics |

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
- `dist/artifacts/install_mac.sh` — one-click installer (download + clear quarantine)
- `dist/artifacts/INSTALL.txt`
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
| `packaging/install_mac.sh` | One-click installer for ad-hoc / unsigned builds |

## One-click install (recommended)

Phase 1 ships **ad-hoc signed** (not Developer ID / not notarized) builds. Downloading the zip/dmg normally sets `com.apple.quarantine`, so Gatekeeper may block a plain double-click.

On a Mac, run:

```bash
curl -fsSL https://raw.githubusercontent.com/Yunz93/StockAgent/main/packaging/install_mac.sh | bash
```

Or from a local checkout / artifact:

```bash
./packaging/install_mac.sh          # downloads latest Release
./packaging/install_mac.sh StockAgent-*.zip
```

What it does:

1. Resolves the latest Release tag via GitHub HTML / atom (avoids `api.github.com` 403)
2. Parses the release asset list from the expanded-assets page
3. Downloads the zip/dmg for the current arch
4. Removes Gatekeeper quarantine (`xattr -cr`)
5. Re-applies ad-hoc `codesign --force --deep --sign -` (with entitlements when available)
6. Copies to `/Applications/StockAgent.app` (override with `INSTALL_DIR=...`)
7. Opens the app (`OPEN_AFTER=0` to skip)

Optional env:

| Var | Default | Meaning |
|-----|---------|---------|
| `TAG` | `latest` | Pin a release tag, e.g. `TAG=v0.0.2` |
| `PREFER` | `zip` | Prefer `zip` or `dmg` |
| `INSTALL_DIR` | `/Applications` | Install destination |
| `OPEN_AFTER` | `1` | Launch after install |
| `GITHUB_TOKEN` | _(empty)_ | Optional; only used if HTML discovery fails and API fallback is needed |
| `ALLOW_LOCAL_FALLBACK` | `0` | If `1`, allow nearby local packages when download fails (does **not** scan `~/Downloads`) |

If download still fails, install a manually downloaded package (use the newest build, not an old `+9`):

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Yunz93/StockAgent/main/packaging/install_mac.sh) \
  ~/Downloads/StockAgent-0.0.3-macos-arm64.zip
```

Manual fallback: drag `.app` into Applications, then right-click → Open, or System Settings → Privacy & Security → Open Anyway.

If the app icon bounces then disappears (闪退), check:

```bash
open -a Console
# or
cat ~/Library/Application\ Support/StockAgent/logs/launch.log
/Applications/StockAgent.app/Contents/MacOS/StockAgent
```

Desktop bootstrap waits only on the lightweight `/api/ready` (or `/api/runtime`) endpoint — never the heavy `/api/health` market probe — so a slow network cannot make the windowed `.app` quit on launch.

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

Tagged releases (`v0.0.2` etc.) also publish the artifacts to a GitHub Release.

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

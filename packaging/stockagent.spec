# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for StockAgent.app (run on macOS)."""

from __future__ import annotations

import sys
from pathlib import Path

# SPECPATH is the directory that contains this .spec file (packaging/).
ROOT = Path(SPECPATH).resolve().parent
sys.path.insert(0, str(ROOT))

from desktop.version import APP_NAME, BUNDLE_ID, __version__, build_number  # noqa: E402

ICON_ICNS = ROOT / "packaging" / "icons" / "StockAgent.icns"
ICON_PNG = ROOT / "packaging" / "icons" / "icon-1024.png"
ICON = str(ICON_ICNS) if ICON_ICNS.exists() else (str(ICON_PNG) if ICON_PNG.exists() else None)

datas = [
    (str(ROOT / "index.html"), "."),
    (str(ROOT / "js"), "js"),
    (str(ROOT / "styles.css"), "."),
    (str(ROOT / "config.json"), "."),
    (str(ROOT / "requirements.txt"), "."),
    (str(ROOT / "desktop"), "desktop"),
    (str(ROOT / "stockagent"), "stockagent"),
    (str(ROOT / "packaging" / "entitlements.plist"), "packaging"),
]

icons_dir = ROOT / "packaging" / "icons"
if icons_dir.exists():
    for path in icons_dir.rglob("*"):
        if path.is_file() and path.suffix.lower() in {".png", ".icns"}:
            datas.append((str(path), "packaging/icons"))

hiddenimports = [
    "desktop",
    "desktop.bootstrap",
    "desktop.paths",
    "desktop.menu",
    "desktop.version",
    "server",
    "stockagent",
    "stockagent.paths",
    "stockagent.defaults",
    "stockagent.state",
    "stockagent.http_client",
    "stockagent.symbols",
    "stockagent.market_time",
    "stockagent.config_store",
    "stockagent.workspace_store",
    "stockagent.indicators",
    "stockagent.quotes",
    "stockagent.dividend",
    "stockagent.health",
    "stockagent.handler",
    "stockagent.serve",
    "webview",
    "webview.platforms.cocoa",
    "objc",
    "AppKit",
    "Foundation",
    "WebKit",
]

a = Analysis(
    [str(ROOT / "desktop" / "bootstrap.py")],
    pathex=[str(ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[str(ROOT / "packaging" / "runtime_hook.py")],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name=APP_NAME,
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    # Windowed: no Terminal console. Startup errors are written to
    # ~/Library/Application Support/StockAgent/logs/launch.log instead.
    console=False,
    disable_windowed_traceback=False,
    # Avoid AppleEvent argv emulation — it is only needed for dropped-file
    # argv injection and can hang/crash GUI apps launched via Finder/`open`.
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=str(ROOT / "packaging" / "entitlements.plist"),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name=APP_NAME,
)

app = BUNDLE(
    coll,
    name=f"{APP_NAME}.app",
    icon=ICON,
    bundle_identifier=BUNDLE_ID,
    info_plist={
        "CFBundleName": APP_NAME,
        "CFBundleDisplayName": APP_NAME,
        "CFBundleIdentifier": BUNDLE_ID,
        "CFBundleShortVersionString": __version__,
        "CFBundleVersion": str(build_number()),
        "CFBundlePackageType": "APPL",
        "CFBundleExecutable": APP_NAME,
        "NSHighResolutionCapable": True,
        "LSMinimumSystemVersion": "12.0",
        "NSPrincipalClass": "NSApplication",
        "NSSupportsAutomaticGraphicsSwitching": True,
        "NSAppTransportSecurity": {
            "NSAllowsLocalNetworking": True,
            "NSAllowsArbitraryLoads": False,
        },
        "LSApplicationCategoryType": "public.app-category.finance",
    },
)

# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for StockAgent.app (run on macOS)."""

import os
from pathlib import Path

ROOT = Path(globals().get("SPECPATH") or os.getcwd()).resolve()

datas = [
    (str(ROOT / "index.html"), "."),
    (str(ROOT / "app.js"), "."),
    (str(ROOT / "styles.css"), "."),
    (str(ROOT / "config.json"), "."),
    (str(ROOT / "desktop"), "desktop"),
]

hiddenimports = [
    "desktop",
    "desktop.bootstrap",
    "desktop.paths",
    "desktop.menu",
    "server",
    "webview",
    "webview.platforms.cocoa",
]

a = Analysis(
    [str(ROOT / "desktop" / "bootstrap.py")],
    pathex=[str(ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="StockAgent",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=True,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="StockAgent",
)

app = BUNDLE(
    coll,
    name="StockAgent.app",
    icon=None,
    bundle_identifier="com.stockagent.desktop",
    info_plist={
        "CFBundleName": "StockAgent",
        "CFBundleDisplayName": "StockAgent",
        "CFBundleShortVersionString": "0.1.0",
        "CFBundleVersion": "0.1.0",
        "NSHighResolutionCapable": True,
        "LSMinimumSystemVersion": "12.0",
        "NSAppTransportSecurity": {
            "NSAllowsLocalNetworking": True,
        },
    },
)

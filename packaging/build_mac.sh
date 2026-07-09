#!/usr/bin/env bash
# Build StockAgent.app with PyInstaller. Must be run on macOS.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PYTHON="${PYTHON:-python3}"
SKIP_INSTALL="${SKIP_INSTALL:-0}"
ADHOC_SIGN="${ADHOC_SIGN:-1}"
MAKE_DMG="${MAKE_DMG:-1}"
MAKE_ZIP="${MAKE_ZIP:-1}"

version="$("$PYTHON" -c 'from desktop.version import __version__; print(__version__)')"
build_no="${STOCKAGENT_BUILD_NUMBER:-${GITHUB_RUN_NUMBER:-$version}}"
export STOCKAGENT_BUILD_NUMBER="$build_no"

echo "==> StockAgent desktop build $version ($build_no)"
echo "    root=$ROOT python=$PYTHON"

if [[ "$SKIP_INSTALL" != "1" ]]; then
  "$PYTHON" -m pip install --upgrade pip
  "$PYTHON" -m pip install -r requirements-desktop.txt
fi

echo "==> Generating icons"
"$PYTHON" packaging/generate_icons.py --icns || "$PYTHON" packaging/generate_icons.py

echo "==> PyInstaller"
"$PYTHON" -m PyInstaller packaging/stockagent.spec --noconfirm --clean --distpath dist --workpath build

APP="$ROOT/dist/StockAgent.app"
if [[ ! -d "$APP" ]]; then
  echo "ERROR: missing $APP" >&2
  exit 1
fi

if [[ "$ADHOC_SIGN" == "1" ]] && command -v codesign >/dev/null 2>&1; then
  echo "==> Ad-hoc codesign"
  codesign --force --deep --sign - \
    --entitlements "$ROOT/packaging/entitlements.plist" \
    "$APP" || echo "WARN: codesign failed (continuing)" >&2
  codesign --verify --verbose=1 "$APP" || true
fi

ARTIFACT_DIR="$ROOT/dist/artifacts"
mkdir -p "$ARTIFACT_DIR"
stamp="${version}+${build_no}"
arch="$(uname -m)"

if [[ "$MAKE_ZIP" == "1" ]]; then
  zip_path="$ARTIFACT_DIR/StockAgent-${stamp}-macos-${arch}.zip"
  echo "==> Zip $zip_path"
  (
    cd "$ROOT/dist"
    ditto -c -k --sequesterRsrc --keepParent "StockAgent.app" "$zip_path"
  )
fi

if [[ "$MAKE_DMG" == "1" ]]; then
  dmg_path="$ARTIFACT_DIR/StockAgent-${stamp}-macos-${arch}.dmg"
  echo "==> DMG $dmg_path"
  rm -f "$dmg_path"
  hdiutil create \
    -volname "StockAgent" \
    -srcfolder "$APP" \
    -ov -format UDZO \
    "$dmg_path"
fi

# Ship the Gatekeeper-friendly installer next to zip/dmg artifacts.
echo "==> Installer script"
cp "$ROOT/packaging/install_mac.sh" "$ARTIFACT_DIR/install_mac.sh"
chmod +x "$ARTIFACT_DIR/install_mac.sh"
cat > "$ARTIFACT_DIR/INSTALL.txt" <<EOF
StockAgent macOS 安装说明
========================

推荐（自动处理未签名 / Gatekeeper 拦截）：

  chmod +x install_mac.sh
  ./install_mac.sh StockAgent-${stamp}-macos-${arch}.zip

或把 zip / dmg 与 install_mac.sh 放在同一目录后直接：

  ./install_mac.sh

脚本会：
  1. 解压 / 挂载安装包
  2. 清除 com.apple.quarantine 隔离属性
  3. 重新 ad-hoc codesign
  4. 安装到 /Applications/StockAgent.app 并启动

手动安装仍可用：解压后拖到「应用程序」，若被拦截请右键 → 打开，
或到「系统设置 → 隐私与安全性」选择仍要打开。
EOF

# Machine-readable build metadata for CI
cat > "$ARTIFACT_DIR/build-info.json" <<EOF
{
  "app": "StockAgent",
  "version": "$version",
  "build": "$build_no",
  "arch": "$arch",
  "app_path": "dist/StockAgent.app",
  "installer": "install_mac.sh",
  "commit": "${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
}
EOF

echo
echo "Built: $APP"
echo "Artifacts: $ARTIFACT_DIR"
ls -lah "$ARTIFACT_DIR" || true
echo "Install: ./dist/artifacts/install_mac.sh <zip|dmg|app>"
echo "Data dir at runtime: ~/Library/Application Support/StockAgent/"

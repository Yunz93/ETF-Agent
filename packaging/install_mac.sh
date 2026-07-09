#!/usr/bin/env bash
# Install StockAgent.app on macOS and clear Gatekeeper quarantine for
# ad-hoc / unsigned builds so users do not need right-click → Open.
#
# Usage:
#   ./packaging/install_mac.sh                         # auto-find zip/dmg/app nearby
#   ./packaging/install_mac.sh StockAgent-....zip
#   ./packaging/install_mac.sh StockAgent-....dmg
#   ./packaging/install_mac.sh /path/to/StockAgent.app
#   curl -fsSL .../install_mac.sh | bash -s -- StockAgent-....zip
#
# Env:
#   INSTALL_DIR   Destination directory (default: /Applications)
#   OPEN_AFTER=1  Launch the app after install (default: 1)
#   ADHOC_SIGN=1  Re-apply ad-hoc codesign (default: 1)
set -euo pipefail

APP_NAME="StockAgent.app"
INSTALL_DIR="${INSTALL_DIR:-/Applications}"
OPEN_AFTER="${OPEN_AFTER:-1}"
ADHOC_SIGN="${ADHOC_SIGN:-1}"

log() { echo "$*"; }
die() {
  echo "ERROR: $*" >&2
  exit 1
}

need_macos() {
  [[ "$(uname -s)" == "Darwin" ]] || die "此脚本仅支持 macOS。"
}

have() {
  command -v "$1" >/dev/null 2>&1
}

resolve_script_dir() {
  local src="${BASH_SOURCE[0]:-}"
  if [[ -n "$src" && -f "$src" ]]; then
    cd "$(dirname "$src")" && pwd
  else
    pwd
  fi
}

find_candidate() {
  local here="$1"
  local c

  # Prefer an already-extracted .app next to the script / cwd.
  for c in \
    "$here/$APP_NAME" \
    "$here/../dist/$APP_NAME" \
    "$here/dist/$APP_NAME" \
    "./$APP_NAME" \
    "./dist/$APP_NAME"
  do
    if [[ -d "$c" ]]; then
      printf '%s\n' "$c"
      return 0
    fi
  done

  # Then look for the newest zip / dmg in common download / artifact locations.
  local search_dirs=("$here" "$here/../dist/artifacts" "$here/dist/artifacts" "./dist/artifacts" "$HOME/Downloads" ".")
  local newest="" newest_mtime=0 mtime
  for dir in "${search_dirs[@]}"; do
    [[ -d "$dir" ]] || continue
    while IFS= read -r -d '' c; do
      mtime=$(stat -f '%m' "$c" 2>/dev/null || echo 0)
      if (( mtime >= newest_mtime )); then
        newest_mtime=$mtime
        newest=$c
      fi
    done < <(find "$dir" -maxdepth 1 \( -name 'StockAgent*.zip' -o -name 'StockAgent*.dmg' \) -print0 2>/dev/null)
  done

  if [[ -n "$newest" ]]; then
    printf '%s\n' "$newest"
    return 0
  fi
  return 1
}

extract_app_from_zip() {
  local zip_path="$1"
  local dest="$2"
  log "==> 解压 zip: $zip_path"
  mkdir -p "$dest"
  if have ditto; then
    ditto -x -k "$zip_path" "$dest"
  else
    unzip -qo "$zip_path" -d "$dest"
  fi
  local found
  found="$(find "$dest" -maxdepth 3 -type d -name "$APP_NAME" | head -n 1 || true)"
  [[ -n "$found" && -d "$found" ]] || die "zip 中未找到 $APP_NAME"
  APP_PATH="$found"
}

extract_app_from_dmg() {
  local dmg_path="$1"
  local dest="$2"
  log "==> 挂载 dmg: $dmg_path"
  mkdir -p "$dest"
  local attach_out mount_point
  attach_out="$(hdiutil attach -nobrowse -readonly "$dmg_path")"
  mount_point="$(echo "$attach_out" | awk '/\/Volumes\//{print $NF; exit}')"
  [[ -n "$mount_point" && -d "$mount_point" ]] || die "无法挂载 dmg"

  cleanup_dmg() {
    hdiutil detach "$mount_point" >/dev/null 2>&1 || true
  }
  trap cleanup_dmg EXIT

  local src="$mount_point/$APP_NAME"
  [[ -d "$src" ]] || src="$(find "$mount_point" -maxdepth 2 -type d -name "$APP_NAME" | head -n 1 || true)"
  [[ -n "$src" && -d "$src" ]] || die "dmg 中未找到 $APP_NAME"

  log "==> 从 dmg 复制 $APP_NAME"
  rm -rf "$dest/$APP_NAME"
  if have ditto; then
    ditto "$src" "$dest/$APP_NAME"
  else
    cp -R "$src" "$dest/$APP_NAME"
  fi

  cleanup_dmg
  trap - EXIT
  APP_PATH="$dest/$APP_NAME"
}

clear_quarantine() {
  local target="$1"
  log "==> 清除隔离属性 (Gatekeeper quarantine)"
  if have xattr; then
    # Remove com.apple.quarantine recursively so Launch Services won't block.
    xattr -cr "$target" 2>/dev/null || true
    xattr -d com.apple.quarantine "$target" 2>/dev/null || true
  else
    echo "WARN: 未找到 xattr，跳过隔离属性清除" >&2
  fi
}

adhoc_sign() {
  local target="$1"
  [[ "$ADHOC_SIGN" == "1" ]] || return 0
  if ! have codesign; then
    echo "WARN: 未找到 codesign，跳过 ad-hoc 签名" >&2
    return 0
  fi
  log "==> Ad-hoc codesign"
  # Deep ad-hoc sign so nested binaries match the outer bundle.
  codesign --force --deep --sign - "$target" 2>/dev/null \
    || echo "WARN: codesign 失败（可继续尝试打开）" >&2
}

same_path() {
  local a b
  a="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
  b="$(cd "$(dirname "$2")" 2>/dev/null && pwd)/$(basename "$2")"
  [[ "$a" == "$b" ]]
}

install_app() {
  local src_app="$1"
  local dest_app="$INSTALL_DIR/$APP_NAME"

  [[ -d "$src_app" ]] || die "无效的 .app: $src_app"
  mkdir -p "$INSTALL_DIR"

  if same_path "$src_app" "$dest_app"; then
    log "==> 已在目标位置: $dest_app"
    INSTALLED_APP="$dest_app"
    return 0
  fi

  log "==> 安装到 $dest_app"
  if [[ -d "$dest_app" ]]; then
    log "    替换已有版本…"
    rm -rf "$dest_app"
  fi

  if have ditto; then
    ditto "$src_app" "$dest_app"
  else
    cp -R "$src_app" "$dest_app"
  fi
  INSTALLED_APP="$dest_app"
}

main() {
  need_macos

  local input="${1:-}"
  local work
  work="$(mktemp -d "${TMPDIR:-/tmp}/stockagent-install.XXXXXX")"
  cleanup() { rm -rf "$work"; }
  trap cleanup EXIT

  APP_PATH=""
  INSTALLED_APP=""

  if [[ -z "$input" ]]; then
    local script_dir
    script_dir="$(resolve_script_dir)"
    input="$(find_candidate "$script_dir")" \
      || die "未指定安装包。用法: $0 <StockAgent.app|*.zip|*.dmg>"
    log "==> 自动选择: $input"
  fi

  [[ -e "$input" ]] || die "找不到文件: $input"

  case "$input" in
    *.app)
      [[ -d "$input" ]] || die "不是有效的 .app 目录: $input"
      APP_PATH="$input"
      ;;
    *.zip)
      extract_app_from_zip "$input" "$work"
      ;;
    *.dmg)
      extract_app_from_dmg "$input" "$work"
      ;;
    *)
      die "不支持的文件类型: $input（需要 .app / .zip / .dmg）"
      ;;
  esac

  clear_quarantine "$APP_PATH"
  adhoc_sign "$APP_PATH"

  install_app "$APP_PATH"
  clear_quarantine "$INSTALLED_APP"
  adhoc_sign "$INSTALLED_APP"

  # Refresh Launch Services so Finder / Spotlight see the new bundle.
  if [[ -x /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister ]]; then
    /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
      -f "$INSTALLED_APP" >/dev/null 2>&1 || true
  fi

  echo
  log "已安装: $INSTALLED_APP"
  log "数据目录: ~/Library/Application Support/StockAgent/"
  echo
  log "说明: 当前为 ad-hoc / 未公证构建。本脚本已清除 quarantine 并重新签名，"
  log "      一般可直接双击打开，无需「右键 → 打开」。"
  log "      若仍被拦截：系统设置 → 隐私与安全性 → 仍要打开。"

  if [[ "$OPEN_AFTER" == "1" ]]; then
    log "==> 启动 StockAgent"
    open "$INSTALLED_APP" || echo "WARN: 自动启动失败，请手动打开 $INSTALLED_APP" >&2
  fi
}

main "$@"

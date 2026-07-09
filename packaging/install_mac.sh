#!/usr/bin/env bash
# StockAgent 一键安装（macOS）
#
# 自动下载最新 GitHub Release，清除 Gatekeeper quarantine，
# 重新 ad-hoc 签名，并安装到 /Applications —— 无需「右键 → 打开」。
#
# 一键安装（推荐）：
#   curl -fsSL https://raw.githubusercontent.com/Yunz93/StockAgent/main/packaging/install_mac.sh | bash
#
# 也可指定本地包或 URL：
#   ./install_mac.sh StockAgent-....zip
#   ./install_mac.sh StockAgent-....dmg
#   ./install_mac.sh /path/to/StockAgent.app
#   ./install_mac.sh https://github.com/.../StockAgent-....zip
#
# Env:
#   REPO          GitHub repo (default: Yunz93/StockAgent)
#   TAG           Release tag (default: latest)
#   INSTALL_DIR   Destination (default: /Applications)
#   OPEN_AFTER=1  Launch after install (default: 1)
#   ADHOC_SIGN=1  Re-apply ad-hoc codesign (default: 1)
#   PREFER=zip    Asset preference: zip | dmg (default: zip)
set -euo pipefail

APP_NAME="StockAgent.app"
REPO="${REPO:-Yunz93/StockAgent}"
TAG="${TAG:-latest}"
INSTALL_DIR="${INSTALL_DIR:-/Applications}"
OPEN_AFTER="${OPEN_AFTER:-1}"
ADHOC_SIGN="${ADHOC_SIGN:-1}"
PREFER="${PREFER:-zip}"
GITHUB_API="${GITHUB_API:-https://api.github.com}"

# Progress to stderr so command substitutions only capture paths.
log() { echo "$*" >&2; }
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

arch_label() {
  case "$(uname -m)" in
    arm64|aarch64) echo "arm64" ;;
    x86_64|amd64)  echo "x86_64" ;;
    *)             uname -m ;;
  esac
}

download() {
  local url="$1" out="$2"
  if have curl; then
    curl -fL --retry 3 --retry-delay 1 -o "$out" "$url"
  elif have wget; then
    wget -O "$out" "$url"
  else
    die "需要 curl 或 wget 才能下载安装包"
  fi
}

fetch_release_json() {
  local url
  if [[ "$TAG" == "latest" ]]; then
    url="$GITHUB_API/repos/$REPO/releases/latest"
  else
    url="$GITHUB_API/repos/$REPO/releases/tags/$TAG"
  fi
  # GitHub API rejects anonymous requests without a User-Agent (403).
  if have curl; then
    curl -fsSL \
      -H "Accept: application/vnd.github+json" \
      -H "User-Agent: StockAgent-install_mac" \
      "$url"
  elif have wget; then
    wget -qO- \
      --header="Accept: application/vnd.github+json" \
      --header="User-Agent: StockAgent-install_mac" \
      "$url"
  else
    die "需要 curl 或 wget 才能查询 GitHub Release"
  fi
}

# Read release JSON from stdin; print browser_download_url on stdout.
pick_asset_url() {
  local arch="$1"
  local prefer="$2"
  local json
  json="$(cat)"

  if have python3; then
    PREFER_EXT="$prefer" ARCH="$arch" python3 -c '
import json, os, sys
prefer = os.environ["PREFER_EXT"].lstrip(".")
arch = os.environ["ARCH"]
data = json.load(sys.stdin)
assets = data.get("assets") or []

def score(name: str):
    name_l = (name or "").lower()
    if not name_l.startswith("stockagent"):
        return (99, 99, name_l)
    ext = name_l.rsplit(".", 1)[-1] if "." in name_l else ""
    if ext not in ("zip", "dmg"):
        return (99, 99, name_l)
    ext_rank = 0 if ext == prefer else 1
    if arch and arch in name_l:
        arch_rank = 0
    elif "macos" in name_l:
        arch_rank = 1
    else:
        arch_rank = 2
    return (ext_rank, arch_rank, name_l)

ranked = sorted(assets, key=lambda a: score(a.get("name") or ""))
best = next((a for a in ranked if score(a.get("name") or "")[0] < 99), None)
if not best:
    sys.exit(2)
sys.stderr.write("    选中资源: %s\n" % best.get("name"))
print(best["browser_download_url"])
' <<<"$json"
    return $?
  fi

  # Fallback without python3 (best-effort).
  local line name url best_url="" best_score=99
  while IFS= read -r line; do
    name="$(echo "$line" | sed -n 's/.*"name":[[:space:]]*"\([^"]*\)".*/\1/p')"
    url="$(echo "$line" | sed -n 's/.*"browser_download_url":[[:space:]]*"\([^"]*\)".*/\1/p')"
    [[ -n "$name" && -n "$url" ]] || continue
    case "$name" in
      StockAgent*.zip|StockAgent*.dmg) ;;
      *) continue ;;
    esac
    local score=50
    [[ "$name" == *."$prefer" ]] && score=10
    [[ "$name" == *"$arch"* ]] && score=$((score - 5))
    if (( score < best_score )); then
      best_score=$score
      best_url=$url
      log "    选中资源: $name"
    fi
  done < <(echo "$json" | tr '{' '\n')
  [[ -n "$best_url" ]] || return 2
  printf '%s\n' "$best_url"
}

download_latest_release() {
  local dest_dir="$1"
  local arch
  arch="$(arch_label)"
  log "==> 查询 GitHub Release: $REPO ($TAG), arch=$arch"
  local json url
  json="$(fetch_release_json)" \
    || die "无法获取 Release 信息。请确认仓库 $REPO 已发布 macOS 产物。"

  local tag_name
  tag_name="$(echo "$json" | sed -n 's/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
  [[ -n "$tag_name" ]] && log "    版本: $tag_name"

  url="$(echo "$json" | pick_asset_url "$arch" "$PREFER")" \
    || die "Release 中未找到 StockAgent macOS zip/dmg。
请检查 https://github.com/$REPO/releases"

  local filename
  filename="$(basename "${url%%\?*}")"
  # GitHub may encode '+' as %2B in the URL path.
  if have python3; then
    filename="$(python3 -c 'import sys,urllib.parse; print(urllib.parse.unquote(sys.argv[1]))' "$filename")"
  else
    filename="${filename//%2B/+}"
    filename="${filename//%2b/+}"
  fi
  local out="$dest_dir/$filename"
  log "==> 下载 $filename"
  download "$url" "$out"
  printf '%s\n' "$out"
}

resolve_script_dir() {
  local src="${BASH_SOURCE[0]:-}"
  if [[ -n "$src" && -f "$src" ]]; then
    cd "$(dirname "$src")" && pwd
  else
    pwd
  fi
}

find_local_candidate() {
  local here="$1"
  local c

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
  log "==> 解压 zip: $(basename "$zip_path")"
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
  log "==> 挂载 dmg: $(basename "$dmg_path")"
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
    xattr -cr "$target" 2>/dev/null || true
    xattr -d com.apple.quarantine "$target" 2>/dev/null || true
  else
    log "WARN: 未找到 xattr，跳过隔离属性清除"
  fi
}

adhoc_sign() {
  local target="$1"
  [[ "$ADHOC_SIGN" == "1" ]] || return 0
  if ! have codesign; then
    log "WARN: 未找到 codesign，跳过 ad-hoc 签名"
    return 0
  fi
  log "==> Ad-hoc codesign"
  codesign --force --deep --sign - "$target" 2>/dev/null \
    || log "WARN: codesign 失败（可继续尝试打开）"
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

usage() {
  cat <<EOF
StockAgent 一键安装（macOS）

一键安装:
  curl -fsSL https://raw.githubusercontent.com/$REPO/main/packaging/install_mac.sh | bash

本地 / 指定包:
  $0                          # 下载最新 Release 并安装
  $0 <StockAgent.app|*.zip|*.dmg|https://...>

环境变量:
  TAG=v0.0.1   指定版本（默认 latest）
  INSTALL_DIR  安装目录（默认 /Applications）
  OPEN_AFTER=0 安装后不自动启动
  PREFER=dmg   优先下载 dmg（默认 zip）
EOF
}

main() {
  local input="${1:-}"
  if [[ "$input" == "-h" || "$input" == "--help" ]]; then
    usage
    exit 0
  fi

  # CI / dry-run: resolve latest asset URL without installing (works on Linux).
  if [[ "${STOCKAGENT_INSTALL_CHECK:-0}" == "1" ]]; then
    local arch
    arch="$(arch_label)"
    log "==> check: $REPO ($TAG), arch=$arch"
    local json url
    json="$(fetch_release_json)" || die "无法获取 Release 信息"
    url="$(echo "$json" | pick_asset_url "$arch" "$PREFER")" \
      || die "未找到 macOS 安装包"
    log "OK: $url"
    printf '%s\n' "$url"
    exit 0
  fi

  need_macos

  local work
  work="$(mktemp -d "${TMPDIR:-/tmp}/stockagent-install.XXXXXX")"
  cleanup() { rm -rf "$work"; }
  trap cleanup EXIT

  APP_PATH=""
  INSTALLED_APP=""

  if [[ -z "$input" ]]; then
    # One-click: download latest GitHub Release.
    # If network fails, fall back to a local package if one exists nearby.
    set +e
    input="$(download_latest_release "$work")"
    local dl_status=$?
    set -e
    if [[ $dl_status -ne 0 || -z "$input" ]]; then
      local script_dir
      script_dir="$(resolve_script_dir)"
      if input="$(find_local_candidate "$script_dir")"; then
        log "==> 下载失败，改用本地包: $input"
      else
        die "无法下载最新 Release，且未找到本地 StockAgent.zip/dmg/app。

一键安装:
  curl -fsSL https://raw.githubusercontent.com/$REPO/main/packaging/install_mac.sh | bash

或手动指定:
  $0 /path/to/StockAgent-*.zip"
      fi
    fi
  fi

  if [[ "$input" == http://* || "$input" == https://* ]]; then
    local remote_name
    remote_name="$(basename "${input%%\?*}")"
    if have python3; then
      remote_name="$(python3 -c 'import sys,urllib.parse; print(urllib.parse.unquote(sys.argv[1]))' "$remote_name")"
    else
      remote_name="${remote_name//%2B/+}"
      remote_name="${remote_name//%2b/+}"
    fi
    log "==> 下载 $remote_name"
    download "$input" "$work/$remote_name"
    input="$work/$remote_name"
  fi

  [[ -e "$input" ]] || die "找不到文件: $input"

  case "$input" in
    *.app)
      [[ -d "$input" ]] || die "不是有效的 .app 目录: $input"
      APP_PATH="$input"
      ;;
    *.zip)
      extract_app_from_zip "$input" "$work/extract"
      ;;
    *.dmg)
      extract_app_from_dmg "$input" "$work/extract"
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

  if [[ -x /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister ]]; then
    /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
      -f "$INSTALLED_APP" >/dev/null 2>&1 || true
  fi

  echo >&2
  log "已安装: $INSTALLED_APP"
  log "数据目录: ~/Library/Application Support/StockAgent/"
  echo >&2
  log "说明: 当前为 ad-hoc / 未公证构建。本脚本已清除 quarantine 并重新签名，"
  log "      一般可直接打开，无需「右键 → 打开」。"
  log "      若仍被拦截：系统设置 → 隐私与安全性 → 仍要打开。"

  if [[ "$OPEN_AFTER" == "1" ]]; then
    log "==> 启动 StockAgent"
    open "$INSTALLED_APP" || log "WARN: 自动启动失败，请手动打开 $INSTALLED_APP"
  fi
}

main "$@"

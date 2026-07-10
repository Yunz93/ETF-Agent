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
#   GITHUB_TOKEN  Optional; used only if API fallback is needed
#   ALLOW_LOCAL_FALLBACK=0  If 1, allow nearby local zip/dmg when download fails
set -euo pipefail

APP_NAME="StockAgent.app"
REPO="${REPO:-Yunz93/StockAgent}"
TAG="${TAG:-latest}"
INSTALL_DIR="${INSTALL_DIR:-/Applications}"
OPEN_AFTER="${OPEN_AFTER:-1}"
ADHOC_SIGN="${ADHOC_SIGN:-1}"
PREFER="${PREFER:-zip}"
GITHUB_API="${GITHUB_API:-https://api.github.com}"
GITHUB_WEB="${GITHUB_WEB:-https://github.com}"
ALLOW_LOCAL_FALLBACK="${ALLOW_LOCAL_FALLBACK:-0}"
# Browser-like UA: api.github.com often 403s anonymous clients / some regions.
HTTP_UA="${HTTP_UA:-Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) StockAgent-install_mac/1.0}"

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

urldecode_name() {
  local name="$1"
  if have python3; then
    python3 -c 'import sys,urllib.parse; print(urllib.parse.unquote(sys.argv[1]))' "$name"
  else
    name="${name//%2B/+}"
    name="${name//%2b/+}"
    printf '%s\n' "$name"
  fi
}

http_get() {
  # GET url → stdout. Retries briefly. Prefer curl.
  local url="$1"
  if have curl; then
    curl -fsSL --retry 3 --retry-delay 1 \
      -A "$HTTP_UA" \
      -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" \
      "$url"
  elif have wget; then
    wget -qO- --user-agent="$HTTP_UA" "$url"
  else
    die "需要 curl 或 wget"
  fi
}

download() {
  local url="$1" out="$2"
  if have curl; then
    curl -fL --retry 3 --retry-delay 1 -A "$HTTP_UA" -o "$out" "$url"
  elif have wget; then
    wget --user-agent="$HTTP_UA" -O "$out" "$url"
  else
    die "需要 curl 或 wget 才能下载安装包"
  fi
}

resolve_release_tag() {
  # Print concrete tag (e.g. v0.0.1). Prefer HTML/atom — avoids api.github.com 403.
  local wanted="$1"
  if [[ "$wanted" != "latest" ]]; then
    printf '%s\n' "$wanted"
    return 0
  fi

  local loc html atom tag
  # 1) Follow /releases/latest redirect Location header.
  if have curl; then
    loc="$(curl -fsSI -A "$HTTP_UA" "$GITHUB_WEB/$REPO/releases/latest" 2>/dev/null \
      | tr -d '\r' \
      | awk 'tolower($1)=="location:"{print $2; exit}')" || true
    if [[ "$loc" =~ /releases/tag/([^/?#]+) ]]; then
      printf '%s\n' "${BASH_REMATCH[1]}"
      return 0
    fi
  fi

  # 2) Atom feed first entry.
  atom="$(http_get "$GITHUB_WEB/$REPO/releases.atom" 2>/dev/null || true)"
  if [[ -n "$atom" ]]; then
    tag="$(printf '%s\n' "$atom" \
      | sed -n 's|.*<link rel="alternate"[^>]*href="[^"]*/releases/tag/\([^"]*\)".*|\1|p' \
      | head -n 1)"
    if [[ -n "$tag" ]]; then
      printf '%s\n' "$tag"
      return 0
    fi
  fi

  # 3) Latest release HTML page.
  html="$(http_get "$GITHUB_WEB/$REPO/releases/latest" 2>/dev/null || true)"
  if [[ -n "$html" ]]; then
    tag="$(printf '%s\n' "$html" \
      | sed -n 's|.*releases/tag/\(v[^"/?#]*\).*|\1|p' \
      | head -n 1)"
    if [[ -n "$tag" ]]; then
      printf '%s\n' "$tag"
      return 0
    fi
  fi

  return 1
}

# Pick best StockAgent-*.zip/dmg URL from a newline list of absolute or relative URLs.
pick_asset_from_urls() {
  local arch="$1"
  local prefer="$2"
  local urls
  urls="$(cat)"

  if have python3; then
    PREFER_EXT="$prefer" ARCH="$arch" REPO="$REPO" GITHUB_WEB="$GITHUB_WEB" python3 -c '
import os, re, sys
from urllib.parse import unquote

prefer = os.environ["PREFER_EXT"].lstrip(".")
arch = os.environ["ARCH"]
web = os.environ["GITHUB_WEB"].rstrip("/")
raw = sys.stdin.read().splitlines()

cands = []
for line in raw:
    line = line.strip()
    if not line:
        continue
    if line.startswith("/"):
        line = web + line
    if "releases/download/" not in line:
        continue
    name = unquote(line.rsplit("/", 1)[-1].split("?", 1)[0])
    name_l = name.lower()
    if not name_l.startswith("stockagent"):
        continue
    if not name_l.endswith((".zip", ".dmg")):
        continue
    if "/archive/" in line:
        continue
    ext = name_l.rsplit(".", 1)[-1]
    ext_rank = 0 if ext == prefer else 1
    if arch and arch in name_l:
        arch_rank = 0
    elif "macos" in name_l:
        arch_rank = 1
    else:
        arch_rank = 2
    m = re.search(r"\+(\d+)", name)
    build = int(m.group(1)) if m else -1
    # Lower tuple wins: prefer matching ext/arch, then newer build.
    cands.append((ext_rank, arch_rank, -build, name_l, line, name))

if not cands:
    sys.exit(2)
cands.sort()
_, _, _, _, url, name = cands[0]
sys.stderr.write("    选中资源: %s\n" % name)
print(url)
' <<<"$urls"
    return $?
  fi

  # Fallback without python3 (best-effort; prefer matching extension).
  local line name url best_url="" best_score=999999 score
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    [[ "$line" == /* ]] && line="$GITHUB_WEB$line"
    [[ "$line" == *"/releases/download/"* ]] || continue
    name="$(basename "${line%%\?*}")"
    name="$(urldecode_name "$name")"
    case "$name" in
      StockAgent*.zip|StockAgent*.dmg) ;;
      *) continue ;;
    esac
    score=50
    [[ "$name" == *."$prefer" ]] && score=$((score - 20))
    [[ "$name" == *"$arch"* ]] && score=$((score - 10))
    if (( score < best_score )); then
      best_score=$score
      best_url=$line
      log "    选中资源: $name"
    fi
  done <<<"$urls"
  [[ -n "$best_url" ]] || return 2
  printf '%s\n' "$best_url"
}

fetch_asset_urls_html() {
  # Parse GitHub expanded_assets HTML (no API). Prints one URL per line.
  local tag="$1"
  local html
  html="$(http_get "$GITHUB_WEB/$REPO/releases/expanded_assets/$tag")" || return 1
  printf '%s\n' "$html" \
    | sed -n 's|.*href="\(/'"$REPO"'/releases/download/[^"]*\)".*|\1|p' \
    | grep -E '\.(zip|dmg)($|\?)' \
    | grep -vi '/archive/' \
    | sort -u
}

fetch_release_json() {
  # Optional API path (often 403 anonymously). Used only as fallback.
  local tag="$1"
  local url
  if [[ "$tag" == "latest" ]]; then
    url="$GITHUB_API/repos/$REPO/releases/latest"
  else
    url="$GITHUB_API/repos/$REPO/releases/tags/$tag"
  fi
  local args=(-fsSL -A "StockAgent-install_mac" -H "Accept: application/vnd.github+json")
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    args+=(-H "Authorization: Bearer $GITHUB_TOKEN")
  fi
  if have curl; then
    curl "${args[@]}" "$url"
  elif have wget; then
    local wh=(-qO- --header="Accept: application/vnd.github+json" --user-agent="StockAgent-install_mac")
    [[ -n "${GITHUB_TOKEN:-}" ]] && wh+=(--header="Authorization: Bearer $GITHUB_TOKEN")
    wget "${wh[@]}" "$url"
  else
    return 1
  fi
}

pick_asset_url_from_json() {
  local arch="$1"
  local prefer="$2"
  local json
  json="$(cat)"
  if have python3; then
    PREFER_EXT="$prefer" ARCH="$arch" python3 -c '
import json, os, re, sys
prefer = os.environ["PREFER_EXT"].lstrip(".")
arch = os.environ["ARCH"]
data = json.load(sys.stdin)
assets = data.get("assets") or []
cands = []
for a in assets:
    name = a.get("name") or ""
    url = a.get("browser_download_url") or ""
    name_l = name.lower()
    if not name_l.startswith("stockagent"):
        continue
    if not name_l.endswith((".zip", ".dmg")):
        continue
    ext = name_l.rsplit(".", 1)[-1]
    ext_rank = 0 if ext == prefer else 1
    if arch and arch in name_l:
        arch_rank = 0
    elif "macos" in name_l:
        arch_rank = 1
    else:
        arch_rank = 2
    m = re.search(r"\+(\d+)", name)
    build = int(m.group(1)) if m else -1
    cands.append((ext_rank, arch_rank, -build, name_l, url, name))
if not cands:
    sys.exit(2)
cands.sort()
_, _, _, _, url, name = cands[0]
sys.stderr.write("    选中资源: %s\n" % name)
print(url)
' <<<"$json"
    return $?
  fi
  # Minimal fallback: first matching zip/dmg URL in JSON text.
  local line name url
  while IFS= read -r line; do
    name="$(echo "$line" | sed -n 's/.*"name":[[:space:]]*"\([^"]*\)".*/\1/p')"
    url="$(echo "$line" | sed -n 's/.*"browser_download_url":[[:space:]]*"\([^"]*\)".*/\1/p')"
    [[ -n "$name" && -n "$url" ]] || continue
    case "$name" in
      StockAgent*."$prefer") printf '%s\n' "$url"; log "    选中资源: $name"; return 0 ;;
    esac
  done < <(echo "$json" | tr '{' '\n')
  return 2
}

resolve_asset_url() {
  local arch="$1"
  local prefer="$2"
  local tag urls json url

  log "==> 查询 GitHub Release: $REPO ($TAG), arch=$arch"
  tag="$(resolve_release_tag "$TAG")" \
    || die "无法解析 Release 标签。请打开 https://github.com/$REPO/releases 确认已发布，或设置 TAG=v0.0.2"
  log "    版本: $tag"

  # Primary: HTML expanded_assets (works when api.github.com returns 403).
  if urls="$(fetch_asset_urls_html "$tag" 2>/dev/null)" && [[ -n "$urls" ]]; then
    if url="$(printf '%s\n' "$urls" | pick_asset_from_urls "$arch" "$prefer")"; then
      printf '%s\n' "$url"
      return 0
    fi
  else
    log "    WARN: 网页资源列表不可用，尝试 GitHub API…"
  fi

  # Fallback: API (may 403 without token / in some networks).
  if json="$(fetch_release_json "$tag" 2>/dev/null)" && [[ -n "$json" ]]; then
    if url="$(printf '%s\n' "$json" | pick_asset_url_from_json "$arch" "$prefer")"; then
      printf '%s\n' "$url"
      return 0
    fi
  else
    log "    WARN: GitHub API 不可用（常见 403）"
  fi

  die "无法获取 Release 安装包。

可手动下载后安装:
  https://github.com/$REPO/releases/tag/$tag

或指定本地包:
  bash <(curl -fsSL https://raw.githubusercontent.com/$REPO/main/packaging/install_mac.sh) ~/Downloads/StockAgent-*-macos-arm64.zip"
}

download_latest_release() {
  local dest_dir="$1"
  local arch url filename out
  arch="$(arch_label)"
  url="$(resolve_asset_url "$arch" "$PREFER")"
  filename="$(basename "${url%%\?*}")"
  filename="$(urldecode_name "$filename")"
  out="$dest_dir/$filename"
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
  # Only search near the script / cwd — never silently pick ~/Downloads,
  # which often still holds an older broken build (e.g. +9 after +23 republish).
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

  local search_dirs=("$here" "$here/../dist/artifacts" "$here/dist/artifacts" "./dist/artifacts" ".")
  local newest="" newest_mtime=0 mtime
  for dir in "${search_dirs[@]}"; do
    [[ -d "$dir" ]] || continue
    while IFS= read -r -d '' c; do
      mtime=$(stat -f '%m' "$c" 2>/dev/null || stat -c '%Y' "$c" 2>/dev/null || echo 0)
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
  [[ -f "$dmg_path" ]] || die "找不到 dmg: $dmg_path"
  mkdir -p "$dest"
  local attach_out mount_point
  if ! attach_out="$(hdiutil attach -nobrowse -readonly "$dmg_path" 2>&1)"; then
    die "无法挂载 dmg（文件可能损坏或不完整）。
请删除旧包后重新下载 build +23 或更新版本:
  https://github.com/$REPO/releases/latest
hdiutil 输出:
$attach_out"
  fi
  mount_point="$(echo "$attach_out" | awk '/\/Volumes\//{print $NF; exit}')"
  [[ -n "$mount_point" && -d "$mount_point" ]] || die "无法挂载 dmg（未找到 /Volumes 挂载点）"

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
  # Prefer shipping entitlements so re-sign keeps network client/server rights.
  # When run via `curl | bash`, BASH_SOURCE is unbound under `set -u` — only
  # look inside the .app bundle in that case.
  local ents=""
  local candidate
  local candidates=()
  local src="${BASH_SOURCE[0]:-}"
  if [[ -n "$src" && -f "$src" ]]; then
    local here
    here="$(cd "$(dirname "$src")" && pwd)" || here=""
    [[ -n "$here" ]] && candidates+=("$here/entitlements.plist")
  fi
  candidates+=(
    "$target/Contents/Resources/packaging/entitlements.plist"
    "$target/Contents/Frameworks/packaging/entitlements.plist"
  )
  for candidate in "${candidates[@]}"; do
    if [[ -f "$candidate" ]]; then
      ents="$candidate"
      break
    fi
  done
  if [[ -n "$ents" ]]; then
    codesign --force --deep --sign - --entitlements "$ents" "$target" 2>/dev/null \
      || log "WARN: codesign 失败（可继续尝试打开）"
  else
    codesign --force --deep --sign - "$target" 2>/dev/null \
      || log "WARN: codesign 失败（可继续尝试打开）"
  fi
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
  TAG=v0.0.2              指定版本（默认 latest）
  INSTALL_DIR             安装目录（默认 /Applications）
  OPEN_AFTER=0            安装后不自动启动
  PREFER=dmg              优先下载 dmg（默认 zip）
  GITHUB_TOKEN=...        可选；仅在网页解析失败、回退 API 时使用
  ALLOW_LOCAL_FALLBACK=1  下载失败时允许使用脚本旁本地包（默认关闭，避免误装旧版）
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
    local arch url
    arch="$(arch_label)"
    log "==> check: $REPO ($TAG), arch=$arch"
    url="$(resolve_asset_url "$arch" "$PREFER")" || die "无法获取 Release 信息"
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
    # Local fallback is opt-in — ~/Downloads often still has an older broken build.
    set +e
    input="$(download_latest_release "$work")"
    local dl_status=$?
    set -e
    if [[ $dl_status -ne 0 || -z "$input" ]]; then
      if [[ "$ALLOW_LOCAL_FALLBACK" == "1" ]]; then
        local script_dir
        script_dir="$(resolve_script_dir)"
        if input="$(find_local_candidate "$script_dir")"; then
          log "==> 下载失败，改用本地包: $input"
        else
          die "无法下载最新 Release，且未找到本地 StockAgent.zip/dmg/app。

一键安装:
  curl -fsSL https://raw.githubusercontent.com/$REPO/main/packaging/install_mac.sh | bash

或手动指定（请用最新 Release 包）:
  $0 ~/Downloads/StockAgent-0.0.2-macos-arm64.zip"
        fi
      else
        die "无法下载最新 Release。

请重试一键安装，或手动下载后指定路径（请用最新 Release 包）:
  https://github.com/$REPO/releases/latest
  bash <(curl -fsSL https://raw.githubusercontent.com/$REPO/main/packaging/install_mac.sh) ~/Downloads/StockAgent-*-macos-arm64.zip"
      fi
    fi
  fi

  if [[ "$input" == http://* || "$input" == https://* ]]; then
    local remote_name
    remote_name="$(basename "${input%%\?*}")"
    remote_name="$(urldecode_name "$remote_name")"
    log "==> 下载 $remote_name"
    download "$input" "$work/$remote_name"
    input="$work/$remote_name"
  fi

  [[ -e "$input" ]] || die "找不到文件: $input"

  # Warn if the user still points at the known-broken first release build.
  case "$(basename "$input")" in
    *'+9-'*|*'%2B9-'*|*'%2b9-'*)
      log "WARN: 检测到旧构建 +9（存在启动闪退）。建议改用最新 Release（当前 0.0.2+）。"
      ;;
  esac

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

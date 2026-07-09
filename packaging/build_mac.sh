#!/usr/bin/env bash
# Build StockAgent.app with PyInstaller. Must be run on macOS.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

python3 -m pip install -r requirements-desktop.txt
python3 -m PyInstaller packaging/stockagent.spec --noconfirm --clean

echo
echo "Built: $ROOT/dist/StockAgent.app"
echo "Run:   open dist/StockAgent.app"
echo "Data:  ~/Library/Application Support/StockAgent/"

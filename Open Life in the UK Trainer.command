#!/bin/zsh
set -euo pipefail

APP_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
APP_FILE="$APP_DIR/index.html"

if [[ ! -f "$APP_FILE" ]]; then
  echo "Could not find index.html in: $APP_DIR"
  echo "Keep this launcher in the same folder as index.html."
  exit 1
fi

open "$APP_FILE"
echo "Life in the UK Trainer opened in your default browser."

#!/bin/bash
set -e

REPO="/Users/a58/Documents/personal/ai-coding/notchi"

export PATH="/usr/bin:/usr/local/bin:/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"
export CARGO_NET_OFFLINE=true
export NODE="/opt/homebrew/Cellar/node/23.11.0/bin/node"

# Kill any stale process on port 1420
lsof -ti:1420 | xargs kill -9 2>/dev/null || true

cd "$REPO"
exec node_modules/.bin/tauri dev

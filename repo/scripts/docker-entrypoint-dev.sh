#!/bin/bash
set -e

# Install dependencies on first boot (when the named volume is empty)
# or when package-lock.json is newer than the installed node_modules marker.
MARKER="/workspace/node_modules/.install-stamp"

if [ ! -f "$MARKER" ] || [ "/workspace/package-lock.json" -nt "$MARKER" ]; then
  echo "[entrypoint] Running npm ci..."
  npm ci
  touch "$MARKER"
  echo "[entrypoint] npm ci complete."
else
  echo "[entrypoint] node_modules up-to-date, skipping npm ci."
fi

# Add local node_modules/.bin to PATH so `ng`, `playwright`, etc. resolve
export PATH="/workspace/node_modules/.bin:$PATH"

# Disable Angular CLI analytics prompt (non-interactive container environment)
export NG_CLI_ANALYTICS=false
ng analytics disable --global 2>/dev/null || true

exec "$@"

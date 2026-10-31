#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "${1:-}" == "--fixture" ]]; then
  export TARIFF_COLLECTOR_MODE=fixture TARIFF_AS_OF_DATE=2026-10-31 TARIFF_SCHEDULER_ENABLED=false
fi
export NEXT_TELEMETRY_DISABLED=1 TRADE_BACKEND=http://127.0.0.1:8017
mkdir -p artifacts
.venv/bin/python -m uvicorn app:app --reload --host 127.0.0.1 --port 8017 >artifacts/backend.log 2>artifacts/backend-error.log &
backend_pid=$!
(cd web && exec node node_modules/next/dist/bin/next dev -H 127.0.0.1 -p 3000) >artifacts/frontend.log 2>artifacts/frontend-error.log &
frontend_pid=$!
cleanup() { kill "$frontend_pid" "$backend_pid" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
printf 'Trade AI: http://127.0.0.1:3000/\n'
wait "$backend_pid" "$frontend_pid"

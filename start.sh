#!/bin/bash
# Lexis — single-command launcher
# Usage: ./start.sh  (or double-click in Finder after chmod +x)

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "→ Killing any existing processes on ports 8000 and 5173..."
lsof -ti :8000 | xargs kill -9 2>/dev/null || true
lsof -ti :5173 | xargs kill -9 2>/dev/null || true
sleep 0.5

echo "→ Starting backend (uvicorn on :8000)..."
cd "$DIR"
uvicorn server:app --port 8000 > /tmp/lexis-backend.log 2>&1 &
BACKEND_PID=$!

echo "→ Starting frontend (vite on :5173)..."
cd "$DIR/frontend"
npm run dev > /tmp/lexis-frontend.log 2>&1 &
FRONTEND_PID=$!

# Wait for frontend to be ready
echo "→ Waiting for servers to boot..."
for i in $(seq 1 30); do
  if curl -s http://localhost:5173 > /dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

echo "→ Opening http://localhost:5173 ..."
open "http://localhost:5173"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Lexis is running                            ║"
echo "║  Frontend → http://localhost:5173            ║"
echo "║  Backend  → http://localhost:8000            ║"
echo "║                                              ║"
echo "║  Logs: tail -f /tmp/lexis-backend.log        ║"
echo "║  Press Ctrl+C to stop both servers           ║"
echo "╚══════════════════════════════════════════════╝"

# Stream both logs to terminal
tail -f /tmp/lexis-backend.log /tmp/lexis-frontend.log &
TAIL_PID=$!

# On Ctrl+C, kill everything
cleanup() {
  echo ""
  echo "→ Shutting down..."
  kill $BACKEND_PID $FRONTEND_PID $TAIL_PID 2>/dev/null
  exit 0
}
trap cleanup INT TERM

wait $BACKEND_PID

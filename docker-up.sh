#!/usr/bin/env bash
set -euo pipefail

# GitVisual — Start
echo ""
echo "🌿 GitVisual — Git Without Command Lines"
echo "========================================="
echo ""

# Kill any process on port 3000 or 8080
kill_port() {
  local port=$1
  local pid
  pid=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    echo "  ⚠️  Killing existing process on port $port (PID $pid)"
    kill -9 "$pid" 2>/dev/null || true
  fi
}

echo "🔍 Checking ports..."
kill_port 3000
kill_port 8080
kill_port 5432

echo ""
echo "🔨 Building and starting containers..."
docker compose up --build -d

echo ""
echo "⏳ Waiting for services to be ready..."
sleep 5

# Wait for backend
for i in $(seq 1 30); do
  if curl -sf http://localhost:8080/api/repos > /dev/null 2>&1; then
    break
  fi
  echo "  Waiting for backend... ($i/30)"
  sleep 2
done

echo ""
echo "✅ GitVisual is running!"
echo ""
echo "  🌐 App:      http://localhost:3000"
echo "  🔧 API:      http://localhost:8080"
echo "  🗄️  Database: localhost:5432 (gitvisual/gitvisual)"
echo ""
echo "📖 See README.md for a full user guide."
echo ""

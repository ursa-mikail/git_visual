#!/usr/bin/env bash
set -euo pipefail

echo ""
echo "🛑 Stopping GitVisual..."
docker compose down
echo ""
echo "✅ All containers stopped. Data is preserved in Docker volumes."
echo "   Run ./docker-up.sh to start again."
echo ""

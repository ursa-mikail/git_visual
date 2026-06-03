#!/usr/bin/env bash
set -euo pipefail

echo ""
echo "🧹 GitVisual — Full Clean"
echo "=========================="
echo ""
echo "⚠️  This will remove all containers, volumes (database data), and built images."
read -r -p "   Are you sure? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
  echo "Cancelled."
  exit 0
fi

echo ""
echo "Stopping and removing containers..."
docker compose down -v --remove-orphans

echo "Removing built images..."
docker rmi gitvisual-backend gitvisual-frontend 2>/dev/null || true

echo ""
echo "✅ Clean complete. Run ./docker-up.sh to start fresh."
echo ""

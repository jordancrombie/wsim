#!/bin/bash
# Check OAuth clients in WSIM auth-server database
#
# Usage:
#   ./scripts/check-oauth-clients.sh
#
# This script queries the OAuthClient table to show all registered clients.
# Useful for diagnosing authentication issues.

set -e

echo "=== WSIM OAuth Client Diagnostic ==="
echo ""

# Check if we're running in docker context
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q 'bsim-wsim-backend'; then
    echo "Found wsim-backend container, querying database..."
    echo ""

    # Query all OAuth clients (mask secrets for security)
    docker exec -i bsim-wsim-backend npx prisma db execute --stdin --schema=/app/prisma/schema.prisma << 'EOSQL'
SELECT
    "clientId",
    "clientName",
    LEFT("clientSecret", 8) || '...' as "clientSecret_preview",
    "redirectUris",
    "scope",
    "trusted",
    "createdAt",
    "updatedAt"
FROM "OAuthClient"
ORDER BY "clientId";
EOSQL

    echo ""
    echo "=== Client Count ==="
    docker exec -i bsim-wsim-backend npx prisma db execute --stdin --schema=/app/prisma/schema.prisma << 'EOSQL'
SELECT COUNT(*) as total_clients FROM "OAuthClient";
EOSQL

else
    echo "wsim-backend container not found."
    echo ""
    echo "If running on production EC2, ensure the container is running:"
    echo "  docker ps | grep wsim"
    echo ""
    echo "To query directly with psql:"
    echo "  psql \$DATABASE_URL -c 'SELECT \"clientId\", \"clientName\" FROM \"OAuthClient\";'"
fi

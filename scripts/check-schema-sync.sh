#!/bin/bash
# =============================================================================
# Schema Sync Validation Script
# =============================================================================
# This script ensures backend and auth-server Prisma schemas stay in sync.
# Run this in CI before deployment to catch accidental schema drift.
#
# Background: Both services share a single PostgreSQL database. If schemas
# drift, `prisma db push` in one service could drop tables used by another.
# See: docs/DEPLOYMENT_GUIDE.md for details on this architecture.
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

BACKEND_SCHEMA="$PROJECT_ROOT/backend/prisma/schema.prisma"
AUTH_SCHEMA="$PROJECT_ROOT/auth-server/prisma/schema.prisma"

echo "Checking Prisma schema sync..."
echo "  Backend:     $BACKEND_SCHEMA"
echo "  Auth-server: $AUTH_SCHEMA"
echo ""

if ! [ -f "$BACKEND_SCHEMA" ]; then
    echo "ERROR: Backend schema not found at $BACKEND_SCHEMA"
    exit 1
fi

if ! [ -f "$AUTH_SCHEMA" ]; then
    echo "ERROR: Auth-server schema not found at $AUTH_SCHEMA"
    exit 1
fi

if diff -q "$BACKEND_SCHEMA" "$AUTH_SCHEMA" > /dev/null 2>&1; then
    echo "SUCCESS: Schemas are in sync"
    exit 0
else
    echo "ERROR: Schemas have drifted!"
    echo ""
    echo "Differences:"
    diff "$BACKEND_SCHEMA" "$AUTH_SCHEMA" || true
    echo ""
    echo "Both services share the same database. Schemas MUST be identical"
    echo "to prevent one service from dropping tables used by the other."
    echo ""
    echo "To fix: Manually sync the schemas, ensuring both files are identical."
    exit 1
fi

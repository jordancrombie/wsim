#!/bin/bash
# Seed OAuth clients for WSIM auth-server
#
# Usage:
#   ./scripts/seed-oauth-clients.sh                    # Use default DATABASE_URL
#   DATABASE_URL="..." ./scripts/seed-oauth-clients.sh # Use custom DATABASE_URL
#
# For Docker:
#   docker exec bsim-wsim-backend npx prisma db execute --stdin < scripts/seed-oauth-clients.sql

set -e

# Default to docker network URL if not set
DATABASE_URL="${DATABASE_URL:-postgresql://wsim:wsim_dev_password@localhost:5433/wsim}"

echo "=== WSIM OAuth Client Seeder ==="
echo ""
echo "This script seeds OAuth clients for SSIMs to use WSIM's OIDC provider."
echo ""

# Check if we're running in docker context
if docker ps --format '{{.Names}}' | grep -q 'bsim-wsim-backend'; then
    echo "Found wsim-backend container, using docker exec..."

    docker exec bsim-wsim-backend npx prisma db execute --stdin --schema=/app/prisma/schema.prisma <<'EOF'
-- Seed SSIM OAuth Client for development
INSERT INTO "OAuthClient" (
    "id",
    "clientId",
    "clientSecret",
    "clientName",
    "redirectUris",
    "postLogoutRedirectUris",
    "grantTypes",
    "scope",
    "logoUri",
    "trusted",
    "createdAt",
    "updatedAt"
) VALUES (
    gen_random_uuid(),
    'ssim-merchant',
    'ssim-dev-secret',
    'Store Simulator',
    ARRAY['https://ssim-dev.banksim.ca/payment/wallet-callback', 'http://localhost:3006/payment/wallet-callback'],
    ARRAY['https://ssim-dev.banksim.ca', 'http://localhost:3006'],
    ARRAY['authorization_code', 'refresh_token'],
    'openid profile email payment:authorize',
    NULL,
    false,
    NOW(),
    NOW()
) ON CONFLICT ("clientId") DO UPDATE SET
    "clientSecret" = EXCLUDED."clientSecret",
    "clientName" = EXCLUDED."clientName",
    "redirectUris" = EXCLUDED."redirectUris",
    "postLogoutRedirectUris" = EXCLUDED."postLogoutRedirectUris",
    "grantTypes" = EXCLUDED."grantTypes",
    "scope" = EXCLUDED."scope",
    "updatedAt" = NOW();
EOF

    echo ""
    echo "✅ SSIM OAuth client seeded successfully!"
    echo ""
    echo "Client Details:"
    echo "  Client ID:     ssim-merchant"
    echo "  Client Secret: ssim-dev-secret"
    echo "  Redirect URIs: https://ssim-dev.banksim.ca/payment/wallet-callback"
    echo "                 http://localhost:3006/payment/wallet-callback"
    echo "  Scopes:        openid profile email payment:authorize"
    echo ""

else
    echo "wsim-backend container not found, using direct database connection..."
    echo "DATABASE_URL: ${DATABASE_URL:0:30}..."

    # Use psql directly
    psql "$DATABASE_URL" <<'EOF'
-- Seed SSIM OAuth Client for development
INSERT INTO "OAuthClient" (
    "id",
    "clientId",
    "clientSecret",
    "clientName",
    "redirectUris",
    "postLogoutRedirectUris",
    "grantTypes",
    "scope",
    "logoUri",
    "trusted",
    "createdAt",
    "updatedAt"
) VALUES (
    gen_random_uuid(),
    'ssim-merchant',
    'ssim-dev-secret',
    'Store Simulator',
    ARRAY['https://ssim-dev.banksim.ca/payment/wallet-callback', 'http://localhost:3006/payment/wallet-callback'],
    ARRAY['https://ssim-dev.banksim.ca', 'http://localhost:3006'],
    ARRAY['authorization_code', 'refresh_token'],
    'openid profile email payment:authorize',
    NULL,
    false,
    NOW(),
    NOW()
) ON CONFLICT ("clientId") DO UPDATE SET
    "clientSecret" = EXCLUDED."clientSecret",
    "clientName" = EXCLUDED."clientName",
    "redirectUris" = EXCLUDED."redirectUris",
    "postLogoutRedirectUris" = EXCLUDED."postLogoutRedirectUris",
    "grantTypes" = EXCLUDED."grantTypes",
    "scope" = EXCLUDED."scope",
    "updatedAt" = NOW();
EOF

    echo ""
    echo "✅ SSIM OAuth client seeded successfully!"
fi

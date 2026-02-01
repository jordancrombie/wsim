#!/bin/bash
# Seed OAuth clients for WSIM auth-server - PRODUCTION
#
# Usage:
#   DATABASE_URL="postgresql://..." ./scripts/seed-oauth-clients-prod.sh
#
# For production EC2 via SSM:
#   docker exec bsim-wsim-backend npx prisma db execute --stdin < scripts/seed-oauth-clients-prod.sql
#
# Required secrets (passed as environment variables):
#   - SSIM_CLIENT_SECRET
#   - REGALMOOSE_CLIENT_SECRET

set -e

echo "=== WSIM OAuth Client Seeder (PRODUCTION) ==="
echo ""

# Check required environment variables
if [ -z "$SSIM_CLIENT_SECRET" ] || [ -z "$REGALMOOSE_CLIENT_SECRET" ]; then
    echo "ERROR: Missing required environment variables"
    echo "  SSIM_CLIENT_SECRET and REGALMOOSE_CLIENT_SECRET must be set"
    exit 1
fi

# Check if we're running in docker context
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q 'bsim-wsim-backend'; then
    echo "Found wsim-backend container, using docker exec..."

    # Create SQL with secrets substituted
    SQL=$(cat << 'EOSQL'
-- SSIM OAuth Client for production
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
    'SSIM_CLIENT_SECRET_PLACEHOLDER',
    'SSIM Store',
    ARRAY['https://ssim.banksim.ca/payment/wallet-callback'],
    ARRAY['https://ssim.banksim.ca'],
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

-- Regalmoose OAuth Client for production
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
    'regalmoose-wsim-merchant',
    'REGALMOOSE_CLIENT_SECRET_PLACEHOLDER',
    'Regalmoose Store',
    ARRAY['https://store.regalmoose.ca/payment/wallet-callback'],
    ARRAY['https://store.regalmoose.ca'],
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
EOSQL
)

    # Substitute secrets
    SQL=$(echo "$SQL" | sed "s|SSIM_CLIENT_SECRET_PLACEHOLDER|$SSIM_CLIENT_SECRET|g" | sed "s|REGALMOOSE_CLIENT_SECRET_PLACEHOLDER|$REGALMOOSE_CLIENT_SECRET|g")

    # Execute via docker
    echo "$SQL" | docker exec -i bsim-wsim-backend npx prisma db execute --stdin --schema=/app/prisma/schema.prisma

    echo ""
    echo "OAuth clients seeded successfully!"
    echo ""
    echo "Clients created/updated:"
    echo "  - ssim-merchant (https://ssim.banksim.ca)"
    echo "  - regalmoose-wsim-merchant (https://store.regalmoose.ca)"

else
    echo "ERROR: wsim-backend container not found."
    echo "This script is designed to run on the production EC2 instance."
    echo ""
    echo "For manual seeding, use:"
    echo "  psql \$DATABASE_URL < seed-oauth-clients-prod.sql"
    exit 1
fi

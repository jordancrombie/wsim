#!/bin/bash
# =============================================================================
# WSIM Mobile API Deployment Script
# =============================================================================
# This script deploys the WSIM mobile API feature branch to the development
# environment. It's designed to be run by the BSIM team as part of their
# docker-compose stack deployment.
#
# Prerequisites:
#   - Docker and docker-compose installed
#   - BSIM stack already running (db container must be up)
#   - Network access to the WSIM repository
#
# Usage:
#   ./scripts/deploy-mobile-api.sh              # Full deployment
#   ./scripts/deploy-mobile-api.sh --migrate    # Run migrations only
#   ./scripts/deploy-mobile-api.sh --seed       # Seed SSIM API key only
#   ./scripts/deploy-mobile-api.sh --check      # Verify deployment status
#
# Environment variables:
#   DATABASE_URL     - PostgreSQL connection string (defaults to docker network)
#   WSIM_BRANCH      - Git branch to deploy (defaults to feature/mobile-api)
#   SKIP_BUILD       - Set to 1 to skip Docker image rebuild
#
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
WSIM_BRANCH="${WSIM_BRANCH:-feature/mobile-api}"
DATABASE_URL="${DATABASE_URL:-postgresql://bsim:bsim_dev_password@db:5432/wsim}"

# Container names (BSIM orchestrated)
BACKEND_CONTAINER="bsim-wsim-backend"
AUTH_CONTAINER="bsim-wsim-auth-server"
FRONTEND_CONTAINER="bsim-wsim-frontend"
DB_CONTAINER="bsim-db"

# =============================================================================
# Helper Functions
# =============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed"
        exit 1
    fi

    # Check docker-compose
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        log_error "docker-compose is not installed"
        exit 1
    fi

    # Check if database is running
    if ! docker ps --format '{{.Names}}' | grep -q "$DB_CONTAINER"; then
        log_error "Database container ($DB_CONTAINER) is not running"
        log_info "Please start the BSIM stack first: make dev-build"
        exit 1
    fi

    log_success "Prerequisites check passed"
}

check_branch() {
    log_info "Checking git branch..."

    current_branch=$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref HEAD)

    if [ "$current_branch" != "$WSIM_BRANCH" ]; then
        log_warning "Currently on branch '$current_branch', expected '$WSIM_BRANCH'"
        read -p "Switch to $WSIM_BRANCH? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            git -C "$PROJECT_ROOT" checkout "$WSIM_BRANCH"
            git -C "$PROJECT_ROOT" pull origin "$WSIM_BRANCH"
            log_success "Switched to $WSIM_BRANCH"
        else
            log_warning "Continuing on branch '$current_branch'"
        fi
    else
        log_success "On correct branch: $WSIM_BRANCH"
        # Pull latest changes
        log_info "Pulling latest changes..."
        git -C "$PROJECT_ROOT" pull origin "$WSIM_BRANCH" || true
    fi
}

validate_schemas() {
    log_info "Validating Prisma schemas are in sync..."

    if ! "$SCRIPT_DIR/check-schema-sync.sh"; then
        log_error "Prisma schemas are out of sync!"
        log_info "Run: cp backend/prisma/schema.prisma auth-server/prisma/schema.prisma"
        exit 1
    fi

    log_success "Schemas are in sync"
}

run_migrations() {
    log_info "Running database migrations..."

    # Check if wsim-backend container exists
    if docker ps --format '{{.Names}}' | grep -q "$BACKEND_CONTAINER"; then
        log_info "Using existing container for migrations..."
        docker exec "$BACKEND_CONTAINER" npx prisma migrate deploy --schema=/app/prisma/schema.prisma
    else
        log_info "Running migrations via direct database connection..."
        cd "$PROJECT_ROOT/backend"
        DATABASE_URL="$DATABASE_URL" npx prisma migrate deploy
        cd "$PROJECT_ROOT"
    fi

    log_success "Migrations completed"
}

generate_prisma_clients() {
    log_info "Generating Prisma clients..."

    if docker ps --format '{{.Names}}' | grep -q "$BACKEND_CONTAINER"; then
        docker exec "$BACKEND_CONTAINER" npx prisma generate --schema=/app/prisma/schema.prisma
    fi

    if docker ps --format '{{.Names}}' | grep -q "$AUTH_CONTAINER"; then
        docker exec "$AUTH_CONTAINER" npx prisma generate --schema=/app/prisma/schema.prisma
    fi

    log_success "Prisma clients generated"
}

seed_ssim_api_key() {
    log_info "Seeding SSIM merchant API key for mobile payments..."

    # SQL to add/update API key for SSIM
    SQL_SEED='
UPDATE "OAuthClient"
SET
    "apiKey" = '\''wsim_api_ssim_dev_key'\'',
    "updatedAt" = NOW()
WHERE "clientId" = '\''ssim-merchant'\'';

-- If no rows updated, the client does not exist yet
-- In that case, run the seed-oauth-clients.sh script first
'

    if docker ps --format '{{.Names}}' | grep -q "$BACKEND_CONTAINER"; then
        echo "$SQL_SEED" | docker exec -i "$BACKEND_CONTAINER" npx prisma db execute --stdin --schema=/app/prisma/schema.prisma
    else
        echo "$SQL_SEED" | psql "$DATABASE_URL"
    fi

    log_success "SSIM API key seeded: wsim_api_ssim_dev_key"
    echo ""
    echo "  SSIM should use this API key in the x-api-key header:"
    echo "  x-api-key: wsim_api_ssim_dev_key"
    echo ""
}

rebuild_containers() {
    if [ "${SKIP_BUILD:-0}" = "1" ]; then
        log_warning "Skipping container rebuild (SKIP_BUILD=1)"
        return
    fi

    log_info "Rebuilding WSIM containers..."

    # This assumes BSIM's docker-compose handles WSIM services
    # Adjust the path and command based on your BSIM setup
    BSIM_DIR="${BSIM_DIR:-$PROJECT_ROOT/../bsim}"

    if [ -d "$BSIM_DIR" ]; then
        cd "$BSIM_DIR"

        # Rebuild only WSIM services
        if [ -f "docker-compose.yml" ] || [ -f "docker-compose.yaml" ]; then
            log_info "Rebuilding wsim-backend..."
            docker-compose build wsim-backend || docker compose build wsim-backend

            log_info "Rebuilding wsim-auth-server..."
            docker-compose build wsim-auth-server || docker compose build wsim-auth-server

            log_info "Rebuilding wsim-frontend..."
            docker-compose build wsim-frontend || docker compose build wsim-frontend

            log_info "Restarting WSIM services..."
            docker-compose up -d wsim-backend wsim-auth-server wsim-frontend || \
            docker compose up -d wsim-backend wsim-auth-server wsim-frontend
        fi

        cd "$PROJECT_ROOT"
    else
        log_warning "BSIM directory not found at $BSIM_DIR"
        log_info "Skipping container rebuild - please rebuild manually"
    fi

    log_success "Container rebuild complete"
}

restart_containers() {
    log_info "Restarting WSIM containers..."

    for container in "$BACKEND_CONTAINER" "$AUTH_CONTAINER" "$FRONTEND_CONTAINER"; do
        if docker ps -a --format '{{.Names}}' | grep -q "$container"; then
            docker restart "$container" 2>/dev/null || true
            log_info "Restarted $container"
        fi
    done

    log_success "Containers restarted"
}

check_health() {
    log_info "Checking service health..."

    # Wait for services to start
    sleep 5

    # Check backend health
    if docker ps --format '{{.Names}}' | grep -q "$BACKEND_CONTAINER"; then
        if docker exec "$BACKEND_CONTAINER" wget -q --spider http://localhost:3003/health 2>/dev/null; then
            log_success "Backend is healthy"
        else
            log_warning "Backend health check failed"
        fi
    fi

    # Check auth server health
    if docker ps --format '{{.Names}}' | grep -q "$AUTH_CONTAINER"; then
        if docker exec "$AUTH_CONTAINER" wget -q --spider http://localhost:3005/health 2>/dev/null; then
            log_success "Auth server is healthy"
        else
            log_warning "Auth server health check failed"
        fi
    fi

    # Test mobile API endpoint
    log_info "Testing mobile API endpoint..."
    if docker exec "$BACKEND_CONTAINER" wget -q -O- http://localhost:3003/api/mobile/enrollment/banks 2>/dev/null | grep -q "banks"; then
        log_success "Mobile API is responding"
    else
        log_warning "Mobile API test failed - may need to wait for startup"
    fi
}

print_summary() {
    echo ""
    echo "============================================================================="
    echo -e "${GREEN}WSIM Mobile API Deployment Complete${NC}"
    echo "============================================================================="
    echo ""
    echo "Branch: $WSIM_BRANCH"
    echo ""
    echo "Mobile API Endpoints (for SSIM integration):"
    echo "  Base URL: https://wsim-dev.banksim.ca/api/mobile"
    echo ""
    echo "  Merchant endpoints (requires x-api-key header):"
    echo "    POST /payment/request          - Create payment request"
    echo "    GET  /payment/:id/status       - Poll for approval"
    echo "    POST /payment/:id/cancel       - Cancel request"
    echo "    POST /payment/:id/complete     - Exchange token for card tokens"
    echo ""
    echo "  Mobile app endpoints (requires JWT auth):"
    echo "    GET  /payment/:id              - Get payment details"
    echo "    POST /payment/:id/approve      - Approve with card"
    echo "    GET  /payment/pending          - List pending payments"
    echo ""
    echo "SSIM API Key: wsim_api_ssim_dev_key"
    echo ""
    echo "Deep Link Format: mwsim://payment/{requestId}"
    echo ""
    echo "Documentation:"
    echo "  - docs/MOBILE_APP_PAYMENT_FLOW.md"
    echo "  - README.md (Mobile API section)"
    echo ""
    echo "============================================================================="
}

# =============================================================================
# Main Execution
# =============================================================================

print_usage() {
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  --migrate    Run database migrations only"
    echo "  --seed       Seed SSIM API key only"
    echo "  --check      Check deployment status only"
    echo "  --help       Show this help message"
    echo ""
    echo "Environment variables:"
    echo "  DATABASE_URL  PostgreSQL connection string"
    echo "  WSIM_BRANCH   Git branch to deploy (default: feature/mobile-api)"
    echo "  SKIP_BUILD    Set to 1 to skip Docker rebuild"
    echo "  BSIM_DIR      Path to BSIM repository (default: ../bsim)"
}

main() {
    echo ""
    echo "============================================================================="
    echo "WSIM Mobile API Deployment"
    echo "============================================================================="
    echo ""

    case "${1:-}" in
        --migrate)
            check_prerequisites
            run_migrations
            generate_prisma_clients
            ;;
        --seed)
            check_prerequisites
            seed_ssim_api_key
            ;;
        --check)
            check_health
            ;;
        --help)
            print_usage
            exit 0
            ;;
        *)
            # Full deployment
            check_prerequisites
            check_branch
            validate_schemas
            rebuild_containers
            run_migrations
            generate_prisma_clients
            seed_ssim_api_key
            restart_containers
            check_health
            print_summary
            ;;
    esac
}

main "$@"

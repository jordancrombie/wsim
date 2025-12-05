# WSIM Integration into BSIM Local Deployment

> **For the BSIM Team**: This document outlines the changes needed to integrate WSIM into the existing BSIM docker-compose orchestration and nginx routing.

## Overview

WSIM (Wallet Simulator) needs to be added to the BSIM local development stack alongside the existing services. Following the established patterns, WSIM will:

- Run as containerized services within the `bsim-network`
- Be accessible via `wsim-dev.banksim.ca` (dev) and `wsim.banksim.ca` (prod)
- Share the PostgreSQL database (separate tables with `Wallet` prefix)
- Integrate with BSIM auth-server for enrollment OAuth flow

## WSIM Container Architecture

WSIM provides production-ready Dockerfiles following BSIM's patterns:

| Service | Dockerfile | Internal Port | Description |
|---------|------------|---------------|-------------|
| wsim-backend | `wsim/backend/Dockerfile` | 3003 | Express API server |
| wsim-auth-server | `wsim/auth-server/Dockerfile` | 3005 | OIDC provider for SSIMs |
| wsim-frontend | `wsim/frontend/Dockerfile` | 3000 | Next.js web app |

### Dockerfile Features

All WSIM Dockerfiles follow BSIM's multi-stage build pattern:
- **Stage 1 (deps)**: Production dependencies only
- **Stage 2 (builder)**: TypeScript compilation / Next.js build
- **Stage 3 (runner)**: Minimal production image with non-root user

Key characteristics:
- Base image: `node:20-alpine`
- Non-root users: `wsim`, `oidc`, `nextjs` (uid 1001)
- Health checks on all services
- OpenSSL installed for Prisma
- Next.js configured for standalone output

---

## Required Changes

### 1. Hosts File Entry

Add to `/etc/hosts` (and update `make dev-hosts` output):

```
127.0.0.1 wsim-dev.banksim.ca
127.0.0.1 wsim-auth-dev.banksim.ca
```

### 2. Nginx Configuration Updates

#### nginx/nginx.dev.conf

Add these server blocks:

```nginx
# ===========================================
# WSIM - Wallet Simulator
# ===========================================

# WSIM Frontend + Backend API
server {
    listen 443 ssl;
    server_name wsim.banksim.ca wsim-dev.banksim.ca;

    ssl_certificate /etc/nginx/certs/banksim.ca.crt;
    ssl_certificate_key /etc/nginx/certs/banksim.ca.key;

    # Disable caching for HTML (same as BSIM frontend)
    add_header Cache-Control "no-cache, no-store, must-revalidate" always;
    add_header Pragma "no-cache" always;
    add_header Expires "0" always;

    # WSIM Backend API
    location /api {
        set $wsim_backend_upstream wsim-backend:3003;
        proxy_pass http://$wsim_backend_upstream;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WSIM Frontend
    location / {
        set $wsim_frontend_upstream wsim-frontend:3000;
        proxy_pass http://$wsim_frontend_upstream;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}

# WSIM Auth Server (OIDC Provider for SSIMs)
server {
    listen 443 ssl;
    server_name wsim-auth.banksim.ca wsim-auth-dev.banksim.ca;

    ssl_certificate /etc/nginx/certs/banksim.ca.crt;
    ssl_certificate_key /etc/nginx/certs/banksim.ca.key;

    location / {
        set $wsim_auth_upstream wsim-auth-server:3005;
        proxy_pass http://$wsim_auth_upstream;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 3. Docker Compose Updates

#### docker-compose.yml (add to services section)

```yaml
  # ===========================================
  # WSIM - Wallet Simulator
  # ===========================================

  wsim-backend:
    build:
      context: ../wsim/backend
      dockerfile: Dockerfile
    container_name: bsim-wsim-backend
    environment:
      NODE_ENV: production
      PORT: 3003
      DATABASE_URL: postgresql://bsim:${POSTGRES_PASSWORD:-bsim_dev_password}@db:5432/bsim
      APP_URL: https://wsim.banksim.ca
      FRONTEND_URL: https://wsim.banksim.ca
      AUTH_SERVER_URL: https://wsim-auth.banksim.ca
      JWT_SECRET: ${WSIM_JWT_SECRET:-wsim-dev-jwt-secret}
      SESSION_SECRET: ${WSIM_SESSION_SECRET:-wsim-dev-session-secret}
      ENCRYPTION_KEY: ${WSIM_ENCRYPTION_KEY:-0123456789abcdef0123456789abcdef}
      CORS_ORIGINS: https://wsim.banksim.ca,https://wsim-auth.banksim.ca
      # BSIM provider for enrollment (WSIM connects to BSIM as OAuth client)
      BSIM_PROVIDERS: '[{"bsimId":"bsim","name":"Bank Simulator","issuer":"https://auth.banksim.ca","apiUrl":"https://banksim.ca","clientId":"wsim-wallet","clientSecret":"${WSIM_BSIM_CLIENT_SECRET:-wsim-dev-secret}"}]'
    depends_on:
      db:
        condition: service_healthy
    networks:
      - bsim-network
    restart: unless-stopped

  wsim-auth-server:
    build:
      context: ../wsim/auth-server
      dockerfile: Dockerfile
    container_name: bsim-wsim-auth-server
    environment:
      NODE_ENV: production
      PORT: 3005
      DATABASE_URL: postgresql://bsim:${POSTGRES_PASSWORD:-bsim_dev_password}@db:5432/bsim
      ISSUER: https://wsim-auth.banksim.ca
      BACKEND_URL: http://wsim-backend:3003
      COOKIE_SECRET: ${WSIM_COOKIE_SECRET:-wsim-dev-cookie-secret}
      CORS_ORIGINS: https://wsim.banksim.ca,https://ssim.banksim.ca
    depends_on:
      db:
        condition: service_healthy
    networks:
      - bsim-network
    restart: unless-stopped

  wsim-frontend:
    build:
      context: ../wsim/frontend
      dockerfile: Dockerfile
      args:
        NEXT_PUBLIC_API_URL: https://wsim.banksim.ca/api
        NEXT_PUBLIC_AUTH_URL: https://wsim-auth.banksim.ca
    container_name: bsim-wsim-frontend
    depends_on:
      - wsim-backend
      - wsim-auth-server
    networks:
      - bsim-network
    restart: unless-stopped
```

#### docker-compose.dev.yml (add overrides)

```yaml
  wsim-backend:
    environment:
      NODE_ENV: development
      APP_URL: https://wsim-dev.banksim.ca
      FRONTEND_URL: https://wsim-dev.banksim.ca
      AUTH_SERVER_URL: https://wsim-auth-dev.banksim.ca
      CORS_ORIGINS: https://wsim-dev.banksim.ca,https://wsim-auth-dev.banksim.ca,https://ssim-dev.banksim.ca,https://dev.banksim.ca
      BSIM_PROVIDERS: '[{"bsimId":"bsim","name":"Bank Simulator","issuer":"https://auth-dev.banksim.ca","apiUrl":"https://dev.banksim.ca","clientId":"wsim-wallet","clientSecret":"wsim-dev-secret"}]'

  wsim-auth-server:
    environment:
      NODE_ENV: development
      ISSUER: https://wsim-auth-dev.banksim.ca
      CORS_ORIGINS: https://wsim-dev.banksim.ca,https://ssim-dev.banksim.ca

  wsim-frontend:
    build:
      args:
        NEXT_PUBLIC_API_URL: https://wsim-dev.banksim.ca/api
        NEXT_PUBLIC_AUTH_URL: https://wsim-auth-dev.banksim.ca
```

### 4. Database Migration

WSIM uses its own tables in the shared database. The tables are prefixed with `Wallet` to avoid conflicts:
- `WalletUser`
- `BsimEnrollment`
- `WalletCard`
- `WalletPaymentConsent`
- `OidcPayload`
- `OAuthClient`

Migrations run automatically on container start via:
```bash
npx prisma migrate deploy
```

If you prefer to run migrations separately:
```bash
# From wsim/backend directory
cd ../wsim/backend && npx prisma migrate deploy
```

### 5. BSIM Auth Server - Register WSIM as OAuth Client

WSIM needs to be registered as an OAuth client in BSIM's auth-server to enable bank enrollment.

Add to BSIM's seed data or create via admin:

```typescript
// BSIM OAuth Client for WSIM
{
  clientId: 'wsim-wallet',
  clientSecret: 'wsim-dev-secret', // Use env var in production
  clientName: 'Wallet Simulator',
  redirectUris: [
    'https://wsim.banksim.ca/api/enrollment/callback/bsim',
    'https://wsim-dev.banksim.ca/api/enrollment/callback/bsim'
  ],
  postLogoutRedirectUris: [
    'https://wsim.banksim.ca',
    'https://wsim-dev.banksim.ca'
  ],
  grantTypes: ['authorization_code', 'refresh_token'],
  scope: 'openid profile email wallet:enroll',
  logoUri: null,
  trusted: true
}
```

**Important**: The redirect URIs use `/api/enrollment/callback/bsim` (not just `/enrollment/callback/bsim`).

---

## Service Port Summary

| Service | Internal Port | External URL (Dev) |
|---------|---------------|-------------------|
| BSIM Frontend | 3000 | https://dev.banksim.ca |
| BSIM Backend | 3001 | https://dev.banksim.ca/api |
| BSIM Admin | 3002 | https://admin-dev.banksim.ca |
| BSIM Auth | 3003 | https://auth-dev.banksim.ca |
| Open Banking | 3004 | https://openbanking-dev.banksim.ca |
| SSIM | varies | https://ssim-dev.banksim.ca |
| NSIM | 3006 | https://payment-dev.banksim.ca |
| **WSIM Backend** | 3003 | https://wsim-dev.banksim.ca/api |
| **WSIM Auth** | 3005 | https://wsim-auth-dev.banksim.ca |
| **WSIM Frontend** | 3000 | https://wsim-dev.banksim.ca |

> **Note**: WSIM services use the same internal ports as their BSIM counterparts but are separate containers with different hostnames. Docker's internal networking handles this.

---

## Dependency Order

```
PostgreSQL (db)
    ↓
├── BSIM Backend
├── BSIM Auth Server
├── WSIM Backend ←── NEW
├── WSIM Auth Server ←── NEW
    ↓
├── WSIM Frontend ←── NEW
├── BSIM Frontend
├── NSIM
    ↓
Nginx (routes all)
```

---

## Makefile Updates (Suggested)

```makefile
# Add to bsim/Makefile

dev-hosts:
	@echo "Add these entries to /etc/hosts:"
	@echo "127.0.0.1 dev.banksim.ca"
	@echo "127.0.0.1 admin-dev.banksim.ca"
	@echo "127.0.0.1 auth-dev.banksim.ca"
	@echo "127.0.0.1 openbanking-dev.banksim.ca"
	@echo "127.0.0.1 ssim-dev.banksim.ca"
	@echo "127.0.0.1 payment-dev.banksim.ca"
	@echo "127.0.0.1 wsim-dev.banksim.ca"        # NEW
	@echo "127.0.0.1 wsim-auth-dev.banksim.ca"   # NEW

wsim-logs:
	docker compose logs -f wsim-backend wsim-auth-server wsim-frontend

wsim-rebuild:
	docker compose build --no-cache wsim-backend wsim-auth-server wsim-frontend
	docker compose up -d wsim-backend wsim-auth-server wsim-frontend

wsim-shell-backend:
	docker compose exec wsim-backend sh

wsim-shell-auth:
	docker compose exec wsim-auth-server sh
```

---

## Testing the Integration

### 1. Build and Start

```bash
# From bsim directory
make dev-build
# Or: docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

### 2. Verify Services

```bash
# Health check
curl -k https://wsim-dev.banksim.ca/api/health

# OIDC discovery
curl -k https://wsim-auth-dev.banksim.ca/.well-known/openid-configuration

# Check logs
make wsim-logs
```

### 3. Test Enrollment Flow

1. Visit https://wsim-dev.banksim.ca
2. Click "Add a Bank"
3. Select "Bank Simulator"
4. Should redirect to https://auth-dev.banksim.ca for BSIM login
5. Log in and consent to `wallet:enroll` scope
6. Should return to WSIM with cards imported
7. Cards should appear on wallet dashboard

### 4. Troubleshooting

**OIDC Discovery Fails**:
```bash
# Check BSIM auth is accessible from WSIM container
docker compose exec wsim-backend wget -qO- https://auth-dev.banksim.ca/.well-known/openid-configuration
```

**Database Connection Fails**:
```bash
# Check database from WSIM container
docker compose exec wsim-backend npx prisma db pull
```

**Redirect URI Mismatch**:
- Ensure BSIM has `wsim-wallet` client registered
- Verify redirect URI exactly matches: `https://wsim-dev.banksim.ca/api/enrollment/callback/bsim`

---

## Future: SSIM Integration

Once enrollment is working, SSIM will need configuration updates for "Pay with Wallet". See [SSIM_SUBPLAN.md](./SSIM_SUBPLAN.md) for details.

SSIM environment additions:
```yaml
WSIM_URL: https://wsim-dev.banksim.ca
WSIM_AUTH_URL: https://wsim-auth-dev.banksim.ca
WSIM_CLIENT_ID: ssim-merchant
WSIM_CLIENT_SECRET: ssim-wsim-secret
```

---

## Questions / Decisions

1. **Database**: WSIM uses the shared `bsim` database with separate tables. If you prefer a separate database, let us know.

2. **Certificates**: The existing `*.banksim.ca` wildcard cert should cover `wsim.banksim.ca` and `wsim-auth.banksim.ca`. Please confirm.

3. **Client ID**: We're using `wsim-wallet` as the OAuth client ID. Is this registered in BSIM's auth-server, or do we need to coordinate on the exact value?

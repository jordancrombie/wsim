# WSIM Integration into BSIM Local Deployment

> **For the BSIM Team**: This document outlines the changes needed to integrate WSIM into the existing BSIM docker-compose orchestration and nginx routing.

## Overview

WSIM (Wallet Simulator) needs to be added to the BSIM local development stack alongside the existing services. Following the established patterns, WSIM will:

- Run as containerized services within the `bsim-network`
- Be accessible via `wsim-dev.banksim.ca` (dev) and `wsim.banksim.ca` (prod)
- Share the PostgreSQL database (separate schema/tables)
- Integrate with existing auth-server for OIDC

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
# WSIM Frontend
server {
    listen 443 ssl;
    server_name wsim.banksim.ca wsim-dev.banksim.ca;

    ssl_certificate /etc/nginx/certs/banksim.ca.crt;
    ssl_certificate_key /etc/nginx/certs/banksim.ca.key;

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
      # BSIM providers for enrollment
      BSIM_PROVIDERS: '[{"bsimId":"bsim","name":"Bank Simulator","issuer":"https://auth.banksim.ca","clientId":"wsim-client","clientSecret":"${WSIM_BSIM_CLIENT_SECRET:-wsim-dev-secret}"}]'
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
      CORS_ORIGINS: https://wsim-dev.banksim.ca,https://wsim-auth-dev.banksim.ca,https://ssim-dev.banksim.ca
      BSIM_PROVIDERS: '[{"bsimId":"bsim","name":"Bank Simulator","issuer":"https://auth-dev.banksim.ca","clientId":"wsim-client","clientSecret":"wsim-dev-secret"}]'
    volumes:
      - ../wsim/backend/src:/app/src:ro

  wsim-auth-server:
    environment:
      NODE_ENV: development
      ISSUER: https://wsim-auth-dev.banksim.ca
      CORS_ORIGINS: https://wsim-dev.banksim.ca,https://ssim-dev.banksim.ca
    volumes:
      - ../wsim/auth-server/src:/app/src:ro

  wsim-frontend:
    build:
      args:
        NEXT_PUBLIC_API_URL: https://wsim-dev.banksim.ca/api
        NEXT_PUBLIC_AUTH_URL: https://wsim-auth-dev.banksim.ca
    volumes:
      - ../wsim/frontend/src:/app/src:ro
```

### 4. Database Migration

WSIM uses its own tables in the shared database. Run migrations:

```bash
# From wsim/backend directory
npx prisma migrate deploy
```

Or add to the BSIM startup script to auto-migrate:

```bash
# In bsim/scripts/db.sh or Makefile
cd ../wsim/backend && npx prisma migrate deploy
```

### 5. BSIM Auth Server - Register WSIM as OAuth Client

WSIM needs to be registered as an OAuth client in BSIM's auth-server to enable bank enrollment.

Add to BSIM's seed data or create via admin:

```typescript
// BSIM OAuth Client for WSIM
{
  clientId: 'wsim-client',
  clientSecret: 'wsim-dev-secret', // Use env var in production
  clientName: 'Wallet Simulator',
  redirectUris: [
    'https://wsim.banksim.ca/enrollment/callback/bsim',
    'https://wsim-dev.banksim.ca/enrollment/callback/bsim'
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

### 6. SSIM Configuration Update

SSIM needs to know about WSIM for "Pay with Wallet" functionality.

Add to SSIM's environment:

```yaml
# In docker-compose for SSIM or ssim/.env
WSIM_URL: https://wsim-dev.banksim.ca
WSIM_AUTH_URL: https://wsim-auth-dev.banksim.ca
WSIM_CLIENT_ID: ssim-merchant
WSIM_CLIENT_SECRET: ssim-wsim-secret
```

And register SSIM as a client in WSIM's auth-server (via database seed):

```typescript
// WSIM OAuth Client for SSIM
{
  clientId: 'ssim-merchant',
  clientSecret: 'ssim-wsim-secret',
  clientName: 'Store Simulator',
  redirectUris: [
    'https://ssim.banksim.ca/payment/wallet-callback',
    'https://ssim-dev.banksim.ca/payment/wallet-callback'
  ],
  postLogoutRedirectUris: [
    'https://ssim.banksim.ca',
    'https://ssim-dev.banksim.ca'
  ],
  grantTypes: ['authorization_code'],
  scope: 'openid payment:authorize',
  trusted: true
}
```

### 7. NSIM Configuration Update

NSIM needs to support multi-BSIM routing. See [NSIM_SUBPLAN.md](./NSIM_SUBPLAN.md) for details.

Key change: NSIM should accept `walletCardToken` for routing:

```yaml
# NSIM environment addition
WSIM_ENABLED: "true"
```

---

## Service Port Summary (Updated)

| Service | Internal Port | External URL (Dev) |
|---------|---------------|-------------------|
| BSIM Frontend | 3000 | https://dev.banksim.ca |
| BSIM Backend | 3001 | https://dev.banksim.ca/api |
| BSIM Admin | 3002 | https://admin-dev.banksim.ca |
| BSIM Auth | 3003 | https://auth-dev.banksim.ca |
| Open Banking | 3004 | https://openbanking-dev.banksim.ca |
| SSIM | 3005 (host) | https://ssim-dev.banksim.ca |
| NSIM | 3006 | https://payment-dev.banksim.ca |
| **WSIM Backend** | 3003 | https://wsim-dev.banksim.ca/api |
| **WSIM Auth** | 3005 | https://wsim-auth-dev.banksim.ca |
| **WSIM Frontend** | 3000 | https://wsim-dev.banksim.ca |

> **Note**: WSIM services use the same internal ports as their BSIM counterparts but are separate containers with different hostnames.

---

## Dependency Order

```
PostgreSQL
    ↓
├── BSIM Backend
├── BSIM Auth Server
├── WSIM Backend ←── NEW
├── WSIM Auth Server ←── NEW
    ↓
├── WSIM Frontend ←── NEW
├── BSIM Frontend
├── NSIM (with WSIM routing support)
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
```

---

## Testing the Integration

1. **Start the stack**:
   ```bash
   make dev-build
   ```

2. **Verify WSIM is running**:
   ```bash
   curl -k https://wsim-dev.banksim.ca/api/health
   curl -k https://wsim-auth-dev.banksim.ca/.well-known/openid-configuration
   ```

3. **Test enrollment flow**:
   - Visit https://wsim-dev.banksim.ca
   - Click "Add a Bank"
   - Should redirect to https://auth-dev.banksim.ca for BSIM login
   - After consent, should return to WSIM with cards imported

4. **Test payment flow** (requires SSIM update):
   - Visit https://ssim-dev.banksim.ca
   - Add items to cart, checkout
   - Click "Pay with Wallet"
   - Should redirect to https://wsim-auth-dev.banksim.ca
   - Select card, authorize
   - Payment should complete via NSIM

---

## Questions for BSIM Team

1. Should WSIM share the same PostgreSQL database or use a separate one?
   - **Current assumption**: Shared database, separate tables (prefixed schema)

2. Should WSIM's auth-server be a separate service or extend BSIM's?
   - **Current assumption**: Separate service (cleaner separation, different OIDC issuer)

3. Port allocation - are 3003/3005 available for WSIM containers?
   - These are the same ports as BSIM backend/auth but different containers
   - Docker internal networking handles this fine

4. Certificate - should WSIM subdomains be added to the wildcard cert?
   - **Current assumption**: Existing `*.banksim.ca` wildcard covers `wsim.banksim.ca` and `wsim-auth.banksim.ca`

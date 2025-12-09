# WSIM Deployment Guide

This guide covers deploying WSIM (Wallet Simulator) in a containerized environment. WSIM consists of three services that work together to provide wallet functionality.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           WSIM Service Architecture                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐        │
│   │  wsim-frontend  │    │  wsim-backend   │    │ wsim-auth-server│        │
│   │                 │    │                 │    │                 │        │
│   │  Next.js UI     │    │  Express API    │    │  OIDC Provider  │        │
│   │  Port 3000      │    │  Port 3003      │    │  Port 3005      │        │
│   └────────┬────────┘    └────────┬────────┘    └────────┬────────┘        │
│            │                      │                      │                  │
│            └──────────────────────┼──────────────────────┘                  │
│                                   │                                         │
│                                   ▼                                         │
│                          ┌─────────────────┐                                │
│                          │   PostgreSQL    │                                │
│                          │   Database      │                                │
│                          └─────────────────┘                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

| Service | Port | Purpose |
|---------|------|---------|
| **wsim-frontend** | 3000 | Next.js web application for users |
| **wsim-backend** | 3003 | Express REST API, card/enrollment management |
| **wsim-auth-server** | 3005 | OIDC provider for merchant integration |

---

## Docker Compose Configuration

### Service Definitions

```yaml
services:
  # WSIM Frontend - User-facing wallet UI
  wsim-frontend:
    build:
      context: ../wsim/frontend
      dockerfile: Dockerfile
    environment:
      - NODE_ENV=production
      - NEXT_PUBLIC_API_URL=https://wsim.example.com/api
      - NEXT_PUBLIC_AUTH_URL=https://wsim-auth.example.com
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    depends_on:
      wsim-backend:
        condition: service_healthy
    networks:
      - internal

  # WSIM Backend - API server
  wsim-backend:
    build:
      context: ../wsim/backend
      dockerfile: Dockerfile
    environment:
      - NODE_ENV=production
      - PORT=3003
      - DATABASE_URL=postgresql://user:password@db:5432/wsim
      - SESSION_SECRET=${WSIM_SESSION_SECRET}
      - CORS_ORIGINS=https://wsim.example.com,https://wsim-auth.example.com
      - BSIM_PROVIDERS=${WSIM_BSIM_PROVIDERS}
      - WEBAUTHN_RP_ID=example.com
      - WEBAUTHN_RP_NAME=WSIM Wallet
      - WEBAUTHN_ORIGINS=https://wsim.example.com,https://wsim-auth.example.com
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3003/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    depends_on:
      db:
        condition: service_healthy
    networks:
      - internal

  # WSIM Auth Server - OIDC provider for merchants
  wsim-auth-server:
    build:
      context: ../wsim/auth-server
      dockerfile: Dockerfile
    environment:
      - NODE_ENV=production
      - PORT=3005
      - DATABASE_URL=postgresql://user:password@db:5432/wsim
      - COOKIE_SECRET=${WSIM_COOKIE_SECRET}
      - OIDC_ISSUER=https://wsim-auth.example.com
      - BACKEND_URL=http://wsim-backend:3003
      - INTERNAL_API_SECRET=${WSIM_INTERNAL_API_SECRET}
      - FRONTEND_URL=https://wsim.example.com
      - WEBAUTHN_RP_ID=example.com
      - WEBAUTHN_RP_NAME=WSIM Wallet
      - WEBAUTHN_ORIGINS=https://wsim.example.com,https://wsim-auth.example.com
      - ALLOWED_POPUP_ORIGINS=https://merchant.example.com
      - ALLOWED_EMBED_ORIGINS=https://merchant.example.com
      - AUTH_ADMIN_JWT_SECRET=${WSIM_AUTH_ADMIN_JWT_SECRET}
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3005/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    depends_on:
      db:
        condition: service_healthy
    networks:
      - internal
```

---

## Nginx Reverse Proxy Configuration

### URL Routing

WSIM uses two subdomains:
- `wsim.example.com` - Frontend and Backend API
- `wsim-auth.example.com` - Auth Server (OIDC provider)

### Nginx Configuration

```nginx
# WSIM Frontend + Backend API
server {
    listen 443 ssl http2;
    server_name wsim.example.com;

    ssl_certificate /etc/ssl/certs/example.com.crt;
    ssl_certificate_key /etc/ssl/private/example.com.key;

    # Backend API
    location /api/ {
        proxy_pass http://wsim-backend:3003/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Cookie handling
        proxy_cookie_path / "/; Secure; HttpOnly; SameSite=None";
    }

    # Frontend (Next.js)
    location / {
        proxy_pass http://wsim-frontend:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

# WSIM Auth Server
server {
    listen 443 ssl http2;
    server_name wsim-auth.example.com;

    ssl_certificate /etc/ssl/certs/example.com.crt;
    ssl_certificate_key /etc/ssl/private/example.com.key;

    location / {
        proxy_pass http://wsim-auth-server:3005;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Cookie handling for cross-origin
        proxy_cookie_path / "/; Secure; HttpOnly; SameSite=None";
    }
}
```

---

## Environment Variables Reference

### Required Variables

| Variable | Service | Description |
|----------|---------|-------------|
| `DATABASE_URL` | backend, auth-server | PostgreSQL connection string |
| `SESSION_SECRET` | backend | Session encryption key (32+ chars) |
| `COOKIE_SECRET` | auth-server | Cookie encryption key (32+ chars) |
| `OIDC_ISSUER` | auth-server | Public URL of auth server |
| `INTERNAL_API_SECRET` | backend, auth-server | Shared secret for internal API calls |

### BSIM Provider Configuration

```bash
# JSON array of bank providers
BSIM_PROVIDERS='[
  {
    "bsimId": "bank-simulator",
    "name": "Bank Simulator",
    "issuer": "https://auth.bank.example.com",
    "apiUrl": "https://api.bank.example.com",
    "clientId": "wsim-wallet",
    "clientSecret": "your-client-secret"
  }
]'
```

### WebAuthn Configuration

| Variable | Description | Example |
|----------|-------------|---------|
| `WEBAUTHN_RP_ID` | Relying Party ID (domain) | `example.com` |
| `WEBAUTHN_RP_NAME` | Display name for passkeys | `WSIM Wallet` |
| `WEBAUTHN_ORIGINS` | Allowed origins (comma-separated) | `https://wsim.example.com,https://wsim-auth.example.com` |

### Merchant Integration

| Variable | Description |
|----------|-------------|
| `ALLOWED_POPUP_ORIGINS` | Origins allowed to open WSIM popup |
| `ALLOWED_EMBED_ORIGINS` | Origins allowed to embed WSIM iframe |
| `CORS_ORIGINS` | Origins allowed for API CORS |

---

## Database Setup

### Shared Database Architecture

> ⚠️ **Important:** Both `wsim-backend` and `wsim-auth-server` share the same PostgreSQL database. Their Prisma schemas **must be kept in sync** to prevent one service from dropping tables used by the other during schema synchronization.

Both services run `prisma db push` on startup to ensure the schema is current. If the schemas differ, one service may inadvertently remove tables it doesn't know about.

**Best practices:**
- When adding models to one schema, add them to both
- Never use `--accept-data-loss` in production startup commands
- Test schema changes locally before deploying

### Initial Migration

```bash
# Run from wsim/backend directory
DATABASE_URL="postgresql://user:password@localhost:5432/wsim" \
  npx prisma migrate deploy

# Or via docker compose
docker compose exec wsim-backend npx prisma migrate deploy
```

### Schema Sync (Development)

```bash
docker compose exec wsim-backend npx prisma db push
```

---

## First-Time Admin Setup

After deployment, create the first administrator:

1. Navigate to: `https://wsim-auth.example.com/administration/setup`
2. Enter admin details (email, name)
3. Register a passkey for authentication
4. You'll be automatically logged in

The setup page is only accessible when no admin users exist.

### Admin Interface Features

- **OAuth Client Management** - Create, edit, delete OAuth clients for merchants
- **Passkey Authentication** - Secure, passwordless admin login
- **Role-based Access** - ADMIN and SUPER_ADMIN roles

---

## Health Checks

All services expose health endpoints:

| Service | Endpoint |
|---------|----------|
| wsim-frontend | `GET /api/health` |
| wsim-backend | `GET /health` |
| wsim-auth-server | `GET /health` |

### Verification Commands

```bash
# Check all services
docker compose ps

# Check specific service logs
docker logs wsim-backend --tail 20

# Test health endpoints
curl -k https://wsim.example.com/api/health
curl -k https://wsim-auth.example.com/health
```

---

## Troubleshooting

### Common Issues

**Database connection errors**
```
Error: Can't reach database server
```
- Verify `DATABASE_URL` is correct
- Ensure database container is healthy
- Check network connectivity between containers

**CORS errors**
```
Access-Control-Allow-Origin missing
```
- Add merchant origin to `CORS_ORIGINS`
- Verify `ALLOWED_POPUP_ORIGINS` includes merchant domain

**Passkey registration fails**
```
InvalidStateError: RP ID mismatch
```
- `WEBAUTHN_RP_ID` must match the parent domain
- All subdomains must share the same RP ID

**Session not found (401 on API calls)**
```
Not authenticated
```
- Verify cookies have `SameSite=None; Secure`
- Ensure HTTPS is used
- Check `CORS_ORIGINS` allows credentials

### Log Commands

```bash
# All WSIM services
docker compose logs wsim-frontend wsim-backend wsim-auth-server --tail 50

# Specific service with follow
docker logs wsim-auth-server -f --tail 20

# Filter for errors
docker logs wsim-backend 2>&1 | grep -i error
```

---

## Security Checklist

- [ ] All secrets are strong (32+ characters, randomly generated)
- [ ] HTTPS is enforced for all endpoints
- [ ] `SameSite=None; Secure` on session cookies
- [ ] CORS origins are explicitly listed (no wildcards)
- [ ] WebAuthn RP ID matches production domain
- [ ] Admin interface uses passkey-only authentication
- [ ] Database credentials are not committed to source control

---

## Updating WSIM

### Pull and Rebuild

```bash
# Pull latest code
cd /path/to/wsim
git pull origin main

# Rebuild containers
docker compose build wsim-frontend wsim-backend wsim-auth-server

# Restart services
docker compose up -d wsim-frontend wsim-backend wsim-auth-server
```

### Database Migrations

```bash
# Run any pending migrations
docker compose exec wsim-backend npx prisma migrate deploy
```

---

*Document created: 2025-12-07*

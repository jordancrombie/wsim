# WSIM Production Deployment Guide

## Embedded BSIM Enrollment & Server-to-Server SSO Release

**Release Date:** 2025-12-11
**Branch:** `feature/embedded-wsim-enrollment` (merged to main)
**Status:** Dev deployment verified working

---

## Pre-Deployment Checklist

- [ ] PR merged to `main`
- [ ] Database migration check completed (see below)
- [ ] Environment variables verified
- [ ] Docker images built and pushed to ECR
- [ ] ECS task definitions updated
- [ ] Services deployed and healthy

---

## 1. Database Changes

### Status: NO SCHEMA CHANGES

This release has **no Prisma schema changes**. The existing database schema supports all new features:
- `BsimEnrollment` table (existing) - stores BSIM user linkage via `fiUserRef`
- `WalletUser` table (existing) - stores enrolled users
- `WalletCard` table (existing) - stores enrolled cards
- `PasskeyCredential` table (existing) - stores passkeys

### Verification (Optional)

If you want to verify no migrations are pending, run a one-off ECS task:

```bash
# Check migration status (read-only, safe to run)
aws ecs run-task \
  --cluster bsim-cluster \
  --task-definition bsim-wsim-backend \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[\"subnet-0a1b2c3d4e5f6g7h8\"],securityGroups=[\"sg-0a1b2c3d4e5f6g7h8\"],assignPublicIp=\"ENABLED\"}" \
  --overrides '{
    "containerOverrides": [{
      "name": "wsim-backend",
      "command": ["npx", "prisma", "migrate", "status"]
    }]
  }'
```

---

## 2. Environment Variable Changes

### wsim-auth-server - NEW VARIABLES REQUIRED

| Variable | Value | Description |
|----------|-------|-------------|
| `BSIM_API_URL` | `https://banksim.ca` | BSIM API URL for server-to-server card fetch |
| `WEBAUTHN_RELATED_ORIGINS` | `https://banksim.ca` | Origins allowed for cross-origin passkey registration |
| `ALLOWED_EMBED_ORIGINS` | Add `https://banksim.ca` | Allow BSIM to embed enrollment iframe |

### Updated Task Definition: `wsim-auth-server-task-definition-v2.json`

Add these to the `environment` array:

```json
{"name": "BSIM_API_URL", "value": "https://banksim.ca"},
{"name": "WEBAUTHN_RELATED_ORIGINS", "value": "https://banksim.ca"},
{"name": "ALLOWED_EMBED_ORIGINS", "value": "https://ssim.banksim.ca,https://store.regalmoose.ca,https://banksim.ca"}
```

### wsim-backend - NO NEW VARIABLES

Existing environment variables are sufficient. The new `/api/partner/sso-token` endpoint uses:
- `JWT_SECRET` (existing) - for signing SSO tokens
- `INTERNAL_API_SECRET` (existing) - for HMAC signature verification
- `FRONTEND_URL` (existing) - for building SSO redirect URL

### Complete Updated Task Definitions

See Appendix A for complete updated task definition JSON files.

---

## 3. Build & Push Docker Images

### 3.1 Authenticate to ECR

```bash
aws ecr get-login-password --region ca-central-1 | \
  docker login --username AWS --password-stdin 301868770392.dkr.ecr.ca-central-1.amazonaws.com
```

### 3.2 Build Images

**Important:** Use `--platform linux/amd64` for Fargate compatibility.

```bash
cd /path/to/wsim

# Build wsim-backend
docker build --platform linux/amd64 --no-cache \
  -t 301868770392.dkr.ecr.ca-central-1.amazonaws.com/bsim/wsim-backend:latest \
  -f backend/Dockerfile \
  backend/

# Build wsim-auth-server
docker build --platform linux/amd64 --no-cache \
  -t 301868770392.dkr.ecr.ca-central-1.amazonaws.com/bsim/wsim-auth-server:latest \
  -f auth-server/Dockerfile \
  auth-server/

# Build wsim-frontend (if needed - no changes in this release)
docker build --platform linux/amd64 --no-cache \
  -t 301868770392.dkr.ecr.ca-central-1.amazonaws.com/bsim/wsim-frontend:latest \
  -f frontend/Dockerfile \
  frontend/
```

### 3.3 Push to ECR

```bash
docker push 301868770392.dkr.ecr.ca-central-1.amazonaws.com/bsim/wsim-backend:latest
docker push 301868770392.dkr.ecr.ca-central-1.amazonaws.com/bsim/wsim-auth-server:latest
docker push 301868770392.dkr.ecr.ca-central-1.amazonaws.com/bsim/wsim-frontend:latest
```

---

## 4. Update ECS Task Definitions

### 4.1 Register Updated Task Definitions

```bash
cd /path/to/bsim/aws

# Update wsim-auth-server (has new env vars)
aws ecs register-task-definition --cli-input-json file://wsim-auth-server-task-definition-v2.json

# Update wsim-backend (code changes only)
aws ecs register-task-definition --cli-input-json file://wsim-backend-task-definition-v2.json
```

### 4.2 Update Services to Use New Task Definitions

```bash
# Get the latest task definition revision numbers
aws ecs describe-task-definition --task-definition bsim-wsim-auth-server --query 'taskDefinition.revision'
aws ecs describe-task-definition --task-definition bsim-wsim-backend --query 'taskDefinition.revision'

# Update services (replace X with the revision number)
aws ecs update-service \
  --cluster bsim-cluster \
  --service bsim-wsim-auth-server \
  --task-definition bsim-wsim-auth-server:X \
  --force-new-deployment

aws ecs update-service \
  --cluster bsim-cluster \
  --service bsim-wsim-backend \
  --task-definition bsim-wsim-backend:X \
  --force-new-deployment
```

---

## 5. Verify Deployment

### 5.1 Check Service Health

```bash
# Check service status
aws ecs describe-services \
  --cluster bsim-cluster \
  --services bsim-wsim-backend bsim-wsim-auth-server \
  --query 'services[*].[serviceName,runningCount,desiredCount,deployments[0].rolloutState]'
```

Wait for:
- `runningCount` equals `desiredCount`
- `rolloutState` is `COMPLETED`

### 5.2 Test Health Endpoints

```bash
# Backend health
curl -s https://wsim.banksim.ca/health/live

# Auth server health
curl -s https://wsim-auth.banksim.ca/health/live
```

### 5.3 Test New Endpoints

```bash
# Test enrollment embed page loads
curl -s -o /dev/null -w "%{http_code}" \
  "https://wsim-auth.banksim.ca/enroll/embed?origin=https://banksim.ca"
# Expected: 200

# Test partner SSO endpoint (will return 400 without proper signature, which is expected)
curl -s -X POST https://wsim.banksim.ca/api/partner/sso-token \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
# Expected: {"error":"missing_fields","message":"bsimId, timestamp, and signature are required"}

# Test SSO endpoint (will return 400 without token, which is expected)
curl -s "https://wsim.banksim.ca/api/auth/sso"
# Expected: {"error":"missing_token","message":"Session token is required"}
```

### 5.4 Check CloudWatch Logs

```bash
# View recent logs
aws logs tail /ecs/bsim-wsim-backend --since 10m
aws logs tail /ecs/bsim-wsim-auth-server --since 10m
```

Look for:
- Successful startup messages
- No error logs
- Health check passing

---

## 6. BSIM Integration Setup

After WSIM is deployed, BSIM needs to implement the server-to-server SSO endpoint.

### 6.1 Required BSIM Backend Endpoint

BSIM needs to add `GET /api/wsim/sso-url` that:
1. Calls WSIM's `POST /api/partner/sso-token` with signed request
2. Returns the SSO URL to the frontend

See [BSIM_ENROLLMENT_INTEGRATION.md](BSIM_ENROLLMENT_INTEGRATION.md#option-1-server-to-server-sso-recommended) for implementation details.

### 6.2 Shared Secret

BSIM must use the same `INTERNAL_API_SECRET` as WSIM for HMAC signature generation:
- **Production value:** `8F8YIa5Ww1t/rscdLAhZmUOQ6ZqkZGYG9jm/di82yt8=`
- This is already configured in both WSIM backend and auth-server

### 6.3 BSIM Environment Variables

BSIM backend needs:
```env
WSIM_BACKEND_URL=https://wsim.banksim.ca
WSIM_SHARED_SECRET=8F8YIa5Ww1t/rscdLAhZmUOQ6ZqkZGYG9jm/di82yt8=
BSIM_ID=bsim
```

---

## 7. Rollback Plan

If issues are discovered after deployment:

### 7.1 Quick Rollback (Revert to Previous Task Definition)

```bash
# Find previous revision
aws ecs list-task-definitions --family-prefix bsim-wsim-auth-server --sort DESC

# Rollback to previous revision (replace X with previous revision number)
aws ecs update-service \
  --cluster bsim-cluster \
  --service bsim-wsim-auth-server \
  --task-definition bsim-wsim-auth-server:X \
  --force-new-deployment

aws ecs update-service \
  --cluster bsim-cluster \
  --service bsim-wsim-backend \
  --task-definition bsim-wsim-backend:X \
  --force-new-deployment
```

### 7.2 Full Rollback (Rebuild Previous Version)

```bash
# Checkout previous commit
git checkout main~1

# Rebuild and push images with :rollback tag
docker build --platform linux/amd64 \
  -t 301868770392.dkr.ecr.ca-central-1.amazonaws.com/bsim/wsim-backend:rollback \
  -f backend/Dockerfile backend/

docker push 301868770392.dkr.ecr.ca-central-1.amazonaws.com/bsim/wsim-backend:rollback

# Update task definition to use :rollback tag and redeploy
```

---

## 8. Post-Deployment Verification

### 8.1 End-to-End Test: In-Bank Enrollment

1. Log into BSIM at https://banksim.ca
2. Navigate to wallet enrollment section
3. Click "Enable Wallet Pay"
4. Verify WSIM enrollment popup opens
5. Select cards and register passkey
6. Verify success message and session token received

### 8.2 End-to-End Test: Server-to-Server SSO

1. Log into BSIM at https://banksim.ca
2. Click "Open WSIM Wallet" (after BSIM implements endpoint)
3. Verify redirect to https://wsim.banksim.ca/wallet
4. Verify user is logged in without passkey prompt

### 8.3 Monitor for Issues

Monitor CloudWatch logs and alarms for:
- 5xx errors
- Elevated latency
- Failed health checks

---

## Appendix A: Updated Task Definition Files

### wsim-auth-server-task-definition-v2.json (Updated)

```json
{
  "containerDefinitions": [
    {
      "name": "wsim-auth-server",
      "image": "301868770392.dkr.ecr.ca-central-1.amazonaws.com/bsim/wsim-auth-server:latest",
      "cpu": 0,
      "portMappings": [
        {
          "containerPort": 3005,
          "hostPort": 3005,
          "protocol": "tcp"
        }
      ],
      "essential": true,
      "environment": [
        {"name": "NODE_ENV", "value": "production"},
        {"name": "PORT", "value": "3005"},
        {"name": "ISSUER", "value": "https://wsim-auth.banksim.ca"},
        {"name": "FRONTEND_URL", "value": "https://wsim.banksim.ca"},
        {"name": "BACKEND_URL", "value": "https://wsim.banksim.ca"},
        {"name": "AUTH_SERVER_URL", "value": "https://wsim-auth.banksim.ca"},
        {"name": "DATABASE_URL", "value": "postgresql://bsimadmin:8O9MwSmoA1IUQfOZyw7H4L2lDoeA2M8w@bsim-db.cb80gi4u4k7g.ca-central-1.rds.amazonaws.com:5432/wsim"},
        {"name": "JWT_SECRET", "value": "5/m6TZR+Ok6ImoOowFSvZ9hJoCVVIUzR085miIdLszU="},
        {"name": "COOKIE_SECRET", "value": "+uK2F22XWsz8fxdg4XGI3kBaAddaDBbOnDbfPtjh+7I="},
        {"name": "AUTH_ADMIN_JWT_SECRET", "value": "GfS/+i3iKpwKGytudXy90soqQvwuEpQW3+C05tZ8JFg="},
        {"name": "INTERNAL_API_SECRET", "value": "8F8YIa5Ww1t/rscdLAhZmUOQ6ZqkZGYG9jm/di82yt8="},
        {"name": "WEBAUTHN_RP_ID", "value": "banksim.ca"},
        {"name": "WEBAUTHN_RP_NAME", "value": "WSIM Wallet"},
        {"name": "WEBAUTHN_ORIGINS", "value": "https://wsim.banksim.ca,https://wsim-auth.banksim.ca"},
        {"name": "WEBAUTHN_RELATED_ORIGINS", "value": "https://banksim.ca"},
        {"name": "CORS_ORIGINS", "value": "https://wsim.banksim.ca,https://ssim.banksim.ca,https://store.regalmoose.ca"},
        {"name": "ALLOWED_POPUP_ORIGINS", "value": "https://ssim.banksim.ca,https://store.regalmoose.ca"},
        {"name": "ALLOWED_EMBED_ORIGINS", "value": "https://ssim.banksim.ca,https://store.regalmoose.ca,https://banksim.ca"},
        {"name": "BSIM_API_URL", "value": "https://banksim.ca"}
      ],
      "mountPoints": [],
      "volumesFrom": [],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/bsim-wsim-auth-server",
          "awslogs-region": "ca-central-1",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "wget -qO- http://localhost:3005/health/live || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      },
      "systemControls": []
    }
  ],
  "family": "bsim-wsim-auth-server",
  "executionRoleArn": "arn:aws:iam::301868770392:role/bsim-ecs-task-execution-role",
  "networkMode": "awsvpc",
  "volumes": [],
  "placementConstraints": [],
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024"
}
```

### wsim-backend-task-definition-v2.json (No Changes Needed)

The existing task definition is sufficient. The new `/api/partner/sso-token` endpoint uses existing environment variables.

---

## Appendix B: New API Endpoints

### POST /api/partner/sso-token (wsim-backend)

Server-to-server endpoint for BSIM to request SSO tokens.

**Request:**
```json
{
  "bsimId": "bsim",
  "bsimUserId": "user-sub-from-bsim",
  "timestamp": 1733929200000,
  "signature": "hmac-sha256-hex"
}
```

**Response:**
```json
{
  "ssoToken": "eyJhbG...",
  "ssoUrl": "https://wsim.banksim.ca/api/auth/sso?token=eyJhbG...",
  "expiresIn": 300,
  "walletId": "wallet-abc"
}
```

### GET /api/auth/sso (wsim-backend)

Exchanges JWT for session cookie and redirects to wallet.

**Query Parameters:**
- `token` (required): JWT session token
- `redirect` (optional): Path to redirect to after login (default: `/wallet`)

### GET /enroll/embed (wsim-auth-server)

Enrollment popup/iframe page for in-bank enrollment.

**Query Parameters:**
- `origin` (required): Parent window origin (must be in `ALLOWED_EMBED_ORIGINS`)

---

## Appendix C: Troubleshooting

### Issue: "Invalid origin" error on enrollment embed

**Cause:** Parent origin not in `ALLOWED_EMBED_ORIGINS`

**Solution:** Add the origin to the task definition:
```json
{"name": "ALLOWED_EMBED_ORIGINS", "value": "...,https://new-origin.com"}
```

### Issue: "Invalid signature" on partner SSO

**Cause:** HMAC signature mismatch

**Solution:** Verify BSIM is using the same `INTERNAL_API_SECRET` value and signing the payload in the exact same format (JSON.stringify with keys in order: bsimId, bsimUserId, timestamp).

### Issue: Cross-origin passkey registration fails

**Cause:** Origin not in `WEBAUTHN_RELATED_ORIGINS` or `/.well-known/webauthn` not accessible

**Solution:**
1. Add origin to `WEBAUTHN_RELATED_ORIGINS`
2. Verify https://wsim-auth.banksim.ca/.well-known/webauthn returns valid JSON

### Issue: SSO redirect fails with cookie error

**Cause:** Session cookie not being set due to SameSite/Secure issues

**Solution:** Ensure:
- Using HTTPS
- `sameSite: 'none'` and `secure: true` in session config
- Trust proxy is enabled (`app.set('trust proxy', 1)`)

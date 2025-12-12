# WSIM Production Deployment Guide

## Embedded BSIM Enrollment & Server-to-Server SSO Release

**Release Date:** 2025-12-11
**Branch:** `feature/embedded-wsim-enrollment` (merged to main)
**Status:** Dev deployment verified working

---

## Pre-Deployment Checklist

- [ ] Code merged to main branch
- [ ] BSIM team has deployed their changes (they provide `/api/wsim/*` endpoints and `/api/wallet/cards/enroll`)
- [ ] Coordinate `INTERNAL_API_SECRET` with BSIM team (must match on both sides)
- [ ] Database schema verified (no migrations needed - existing schema supports this feature)

---

## 1. Database Changes

### Status: NO SCHEMA CHANGES

This release has **no Prisma schema changes**. The existing database schema supports all new features:
- `BsimEnrollment` table (existing) - stores BSIM user linkage via `fiUserRef`
- `WalletUser` table (existing) - stores enrolled users
- `WalletCard` table (existing) - stores enrolled cards
- `PasskeyCredential` table (existing) - stores passkeys

### Verification (Optional)

Run a one-off ECS task to verify no migrations are pending:

```bash
aws ecs run-task \
  --cluster bsim-cluster \
  --task-definition bsim-wsim-db-query:1 \
  --launch-type FARGATE \
  --network-configuration '{
    "awsvpcConfiguration": {
      "subnets": ["subnet-0eca3679c80fb2a74"],
      "securityGroups": ["sg-0a5c92cfee8486bb3"],
      "assignPublicIp": "ENABLED"
    }
  }' \
  --overrides '{
    "containerOverrides": [{
      "name": "psql",
      "environment": [{
        "name": "SQL_QUERY",
        "value": "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '\''BsimEnrollment'\'';"
      }]
    }]
  }' \
  --region ca-central-1
```

---

## 2. Environment Variable Changes

### wsim-auth-server - NEW VARIABLES REQUIRED

| Variable | Current Value | New Value | Description |
|----------|---------------|-----------|-------------|
| `ALLOWED_EMBED_ORIGINS` | `https://ssim.banksim.ca,https://store.regalmoose.ca` | `https://ssim.banksim.ca,https://store.regalmoose.ca,https://banksim.ca` | **Add BSIM production origin** |
| `BSIM_API_URL` | *(not set)* | `https://banksim.ca` | **NEW** - BSIM API URL for server-to-server card fetch |
| `WEBAUTHN_RELATED_ORIGINS` | *(not set)* | `https://banksim.ca` | **NEW** - Allow BSIM to register passkeys with WSIM's RP ID |

### wsim-backend - NO NEW VARIABLES

The existing environment variables are sufficient. The new `/api/partner/sso-token` endpoint uses:
- `JWT_SECRET` (existing) - for signing SSO tokens
- `INTERNAL_API_SECRET` (existing) - for HMAC signature verification
- `FRONTEND_URL` (existing) - for building SSO redirect URL

### Verify Shared Secret

The `INTERNAL_API_SECRET` is already set to `8F8YIa5Ww1t/rscdLAhZmUOQ6ZqkZGYG9jm/di82yt8=`.
**Confirm this matches BSIM's `WSIM_SHARED_SECRET`.**

---

## 3. Build & Push Docker Images

### 3.1 Authenticate to ECR

```bash
aws ecr get-login-password --region ca-central-1 | \
  docker login --username AWS --password-stdin 301868770392.dkr.ecr.ca-central-1.amazonaws.com
```

### 3.2 Build Images

**IMPORTANT:** Always use `--no-cache` to ensure fresh builds with latest code!

```bash
cd /path/to/wsim

# Build wsim-auth-server
docker build --platform linux/amd64 --no-cache \
  -t 301868770392.dkr.ecr.ca-central-1.amazonaws.com/bsim/wsim-auth-server:latest \
  -f auth-server/Dockerfile \
  auth-server/

# Build wsim-backend
docker build --platform linux/amd64 --no-cache \
  -t 301868770392.dkr.ecr.ca-central-1.amazonaws.com/bsim/wsim-backend:latest \
  -f backend/Dockerfile \
  backend/
```

### 3.3 Push to ECR

```bash
docker push 301868770392.dkr.ecr.ca-central-1.amazonaws.com/bsim/wsim-auth-server:latest
docker push 301868770392.dkr.ecr.ca-central-1.amazonaws.com/bsim/wsim-backend:latest
```

---

## 4. Update ECS Task Definitions

### 4.1 Update wsim-auth-server Task Definition

Get the current task definition and add new environment variables:

```bash
# Get current task definition
aws ecs describe-task-definition \
  --task-definition bsim-wsim-auth-server:7 \
  --region ca-central-1 > /tmp/wsim-auth-task.json
```

Edit `/tmp/wsim-auth-task.json` to add/update these environment variables:

```json
{"name": "ALLOWED_EMBED_ORIGINS", "value": "https://ssim.banksim.ca,https://store.regalmoose.ca,https://banksim.ca"},
{"name": "BSIM_API_URL", "value": "https://banksim.ca"},
{"name": "WEBAUTHN_RELATED_ORIGINS", "value": "https://banksim.ca"}
```

**Remove these fields before registering** (they're returned by describe but can't be in register):
- `taskDefinitionArn`
- `revision`
- `status`
- `requiresAttributes`
- `compatibilities`
- `registeredAt`
- `registeredBy`

```bash
# Register new task definition
aws ecs register-task-definition \
  --cli-input-json file:///tmp/wsim-auth-task.json \
  --region ca-central-1
```

### 4.2 wsim-backend Task Definition

No environment variable changes needed. Just rebuild and push the Docker image for code changes.

---

## 5. Deploy Services

```bash
# Get the new task definition revision numbers
aws ecs list-task-definitions --family-prefix bsim-wsim-auth-server --sort DESC --max-items 1 --region ca-central-1
aws ecs list-task-definitions --family-prefix bsim-wsim-backend --sort DESC --max-items 1 --region ca-central-1

# Update wsim-auth-server (replace :8 with actual revision)
aws ecs update-service \
  --cluster bsim-cluster \
  --service bsim-wsim-auth-service \
  --task-definition bsim-wsim-auth-server:8 \
  --force-new-deployment \
  --region ca-central-1

# Update wsim-backend (replace :5 with actual revision)
aws ecs update-service \
  --cluster bsim-cluster \
  --service bsim-wsim-backend-service \
  --task-definition bsim-wsim-backend:5 \
  --force-new-deployment \
  --region ca-central-1
```

### Monitor Deployment

```bash
# Check deployment status
for svc in bsim-wsim-auth-service bsim-wsim-backend-service; do
  echo "=== $svc ==="
  aws ecs describe-services \
    --cluster bsim-cluster \
    --services $svc \
    --region ca-central-1 \
    --query 'services[0].{name:serviceName,running:runningCount,desired:desiredCount,pending:pendingCount}' \
    --output json
done

# View logs for issues
aws logs tail /ecs/bsim-wsim-auth-server --follow --region ca-central-1
aws logs tail /ecs/bsim-wsim-backend --follow --region ca-central-1
```

---

## 6. Running Database Queries (ECS One-Off Tasks)

Production does **not** have direct `psql` access. All database operations must be run as ECS one-off tasks.

### 6.1 Run a Query

Use the existing `bsim-wsim-db-query` task definition:

```bash
aws ecs run-task \
  --cluster bsim-cluster \
  --task-definition bsim-wsim-db-query:1 \
  --launch-type FARGATE \
  --network-configuration '{
    "awsvpcConfiguration": {
      "subnets": ["subnet-0eca3679c80fb2a74"],
      "securityGroups": ["sg-0a5c92cfee8486bb3"],
      "assignPublicIp": "ENABLED"
    }
  }' \
  --overrides '{
    "containerOverrides": [{
      "name": "psql",
      "environment": [{
        "name": "SQL_QUERY",
        "value": "YOUR SQL HERE"
      }]
    }]
  }' \
  --region ca-central-1
```

### 6.2 View Query Results

```bash
aws logs tail /ecs/bsim-wsim-db-query --follow --region ca-central-1
```

### 6.3 Example: Check User's SSO Enrollment

```sql
SELECT be."fiUserRef", be."bsimId", wu.email, wu.id as wsim_user_id
FROM "BsimEnrollment" be
JOIN "WalletUser" wu ON be."userId" = wu.id
WHERE wu.email = 'user@example.com';
```

### 6.4 Example: Fix fiUserRef Mismatch (for SSO)

**CAUTION:** Only run UPDATE queries if you're certain of the correct values.

```sql
UPDATE "BsimEnrollment"
SET "fiUserRef" = 'correct-bsim-user-id'
WHERE "userId" = (SELECT id FROM "WalletUser" WHERE email = 'user@example.com');
```

---

## 7. Post-Deployment Testing

### Test 1: Health Endpoints

```bash
# Backend health
curl -s https://wsim.banksim.ca/health/live

# Auth server health
curl -s https://wsim-auth.banksim.ca/health/live
```

### Test 2: Enrollment Embed Page

```bash
# Should return 200
curl -s -o /dev/null -w "%{http_code}" \
  "https://wsim-auth.banksim.ca/enroll/embed?origin=https://banksim.ca"
```

### Test 3: Partner SSO Endpoint

```bash
# Should return validation error (expected without proper signature)
curl -s -X POST https://wsim.banksim.ca/api/partner/sso-token \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
# Expected: {"error":"missing_fields","message":"bsimId, timestamp, and signature are required"}
```

### Test 4: End-to-End Enrollment

1. Log into BSIM at https://banksim.ca
2. Navigate to **Wallet Pay** page
3. Click **"Enable Wallet Pay"**
4. Verify popup opens at https://wsim-auth.banksim.ca/enroll/embed
5. Verify cards are displayed (fetched server-to-server from BSIM)
6. Select card(s) and register passkey
7. Verify success message

### Test 5: Server-Side SSO

1. After enrollment, click **"Open WSIM Wallet"** in BSIM
2. Verify WSIM wallet opens in new tab with automatic login (no passkey prompt)
3. Verify correct user is logged in

---

## 8. Rollback Plan

### Quick Rollback (Revert to Previous Task Definition)

```bash
# Rollback wsim-auth-server to previous version
aws ecs update-service \
  --cluster bsim-cluster \
  --service bsim-wsim-auth-service \
  --task-definition bsim-wsim-auth-server:7 \
  --force-new-deployment \
  --region ca-central-1

# Rollback wsim-backend to previous version
aws ecs update-service \
  --cluster bsim-cluster \
  --service bsim-wsim-backend-service \
  --task-definition bsim-wsim-backend:4 \
  --force-new-deployment \
  --region ca-central-1
```

---

## 9. Troubleshooting

### Issue: "Invalid origin" error in enrollment popup

**Cause:** BSIM origin not in `ALLOWED_EMBED_ORIGINS`

**Fix:** Update task definition to include `https://banksim.ca` in `ALLOWED_EMBED_ORIGINS`

### Issue: "Failed to fetch cards from bank" during enrollment

**Cause:** `BSIM_API_URL` not set or incorrect, or BSIM's card endpoint not deployed

**Solution:**
1. Verify `BSIM_API_URL` is set to `https://banksim.ca`
2. Test BSIM's card endpoint: `curl https://banksim.ca/api/wallet/cards/enroll`
3. Confirm BSIM has deployed their embedded enrollment changes

### Issue: "Invalid signature" on Partner SSO

**Cause:** HMAC signature mismatch

**Solution:** Verify BSIM is using the same `INTERNAL_API_SECRET` value and signing the payload correctly.

Payload must be signed as: `JSON.stringify({ bsimId, bsimUserId, email, timestamp })` (with undefined values removed)

### Issue: SSO returns 404 "user_not_found"

**Cause:** User's `BsimEnrollment.fiUserRef` doesn't match the BSIM user ID.

**Background:** Users who enrolled via OIDC flow (not embedded enrollment) have `fiUserRef` set to the OIDC `sub` claim, which may differ from the BSIM user ID.

**Investigation (via ECS one-off task):**
```sql
SELECT be."fiUserRef", be."bsimId", wu.email
FROM "BsimEnrollment" be
JOIN "WalletUser" wu ON be."userId" = wu.id
WHERE wu.email = 'user@example.com';
```

**Solutions:**
1. **Preferred:** User re-enrolls via embedded enrollment (from BSIM dashboard)
2. **Manual fix:** Update `fiUserRef` to match the correct BSIM user ID

### Issue: Cross-origin passkey registration fails

**Cause:** Origin not in `WEBAUTHN_RELATED_ORIGINS`

**Solution:**
1. Add origin to `WEBAUTHN_RELATED_ORIGINS`
2. Verify https://wsim-auth.banksim.ca/.well-known/webauthn returns valid JSON

---

## 10. New API Endpoints Summary

| Service | Endpoint | Method | Purpose |
|---------|----------|--------|---------|
| auth-server | `/enroll/embed` | GET | Serve embedded enrollment page |
| auth-server | `/enroll/embed/check` | POST | Check if user is already enrolled |
| auth-server | `/enroll/embed/cards` | POST | Fetch cards server-to-server |
| auth-server | `/enroll/embed/passkey/register/options` | POST | Generate passkey options |
| auth-server | `/enroll/embed/passkey/register/verify` | POST | Verify passkey and create user |
| backend | `/api/partner/sso-token` | POST | Generate SSO token for partners |
| frontend | `/api/auth/sso` | GET | Exchange SSO token for session |

---

## 11. BSIM Integration Requirements

For the integration to work, BSIM must have deployed:

1. **Backend endpoints:**
   - `GET /api/wsim/config` - Returns WSIM configuration
   - `GET /api/wsim/enrollment-data` - Returns signed enrollment payload
   - `GET /api/wsim/enrollment-status` - Check user's enrollment status
   - `POST /api/wsim/enrollment-complete` - Mark enrollment complete
   - `GET /api/wsim/sso-url` - Get SSO URL for wallet access
   - `GET /api/wallet/cards/enroll` - Return user's cards (cardToken JWT auth)

2. **Environment variables:**
   - `WSIM_SHARED_SECRET` = `8F8YIa5Ww1t/rscdLAhZmUOQ6ZqkZGYG9jm/di82yt8=` (must match WSIM's `INTERNAL_API_SECRET`)
   - `WSIM_AUTH_URL` = `https://wsim-auth.banksim.ca`
   - `BSIM_ID` = `bsim`

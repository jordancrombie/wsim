# Deployment Guide: P2P Accounts Proxy

**Feature**: P2P Accounts Proxy for mwsim Integration
**Branch**: `feature/p2p-accounts-proxy`
**Date**: January 2026

---

## Overview

This deployment adds support for mwsim to fetch real bank account balances through WSIM. It includes:

1. **New endpoint**: `GET /api/mobile/accounts` - Aggregates accounts from all enrolled BSIMs
2. **Schema change**: New `accessToken` field in `BsimEnrollment` for JWT storage
3. **OAuth change**: Added `offline_access` scope for refresh token support
4. **Token handling**: Separate storage for `accessToken` (JWT) and `walletCredential` (wcred_xxx)
5. **P2P routing**: Prefer `bsim_user_id` over `fi_user_ref` for account ownership

---

## Pre-Deployment Checklist

- [ ] Confirm WSIM feature branch `feature/p2p-accounts-proxy` is merged to `main`
- [ ] Confirm BSIM has deployed `bsim_user_id` claim support (required for P2P ownership validation)
- [ ] Schedule deployment window (minimal downtime expected)
- [ ] Notify mwsim team of deployment timeline

---

## Step 1: Database Schema Update

**REQUIRED**: Add the `accessToken` column to the `BsimEnrollment` table.

### Option A: Using Prisma Migrate (Recommended for Production)

This creates a proper migration file for tracking:

```bash
# Set DATABASE_URL environment variable, then:
DATABASE_URL="postgresql://user:password@host:5432/dbname" \
npx prisma migrate dev --name add_access_token_field
```

For production with existing migrations:

```bash
DATABASE_URL="postgresql://user:password@host:5432/dbname" \
npx prisma migrate deploy
```

### Option B: Using Prisma DB Push (Simpler, No Migration File)

```bash
DATABASE_URL="postgresql://user:password@host:5432/dbname" \
npx prisma db push
```

### Option C: Direct SQL (Alternative)

If Prisma is not available, run this SQL directly:

```sql
ALTER TABLE "BsimEnrollment"
ADD COLUMN IF NOT EXISTS "accessToken" TEXT;
```

### Verify Schema Update

```sql
\d "BsimEnrollment"
```

**Expected**: Should show `accessToken | text` in the column list.

---

## Step 2: Build and Deploy WSIM Backend

### 2.1 Pull Latest Code

```bash
git checkout main
git pull origin main
```

### 2.2 Build Docker Image

```bash
docker build -t wsim-backend:latest ./backend
```

Or if using a build pipeline:

```bash
# Trigger CI/CD build for wsim-backend
# Tag: latest or specific version tag
```

### 2.3 Push to Container Registry

```bash
# AWS ECR example:
aws ecr get-login-password --region <REGION> | docker login --username AWS --password-stdin <ACCOUNT>.dkr.ecr.<REGION>.amazonaws.com

docker tag wsim-backend:latest <ACCOUNT>.dkr.ecr.<REGION>.amazonaws.com/wsim-backend:latest
docker push <ACCOUNT>.dkr.ecr.<REGION>.amazonaws.com/wsim-backend:latest
```

### 2.4 Deploy to ECS

```bash
# Force new deployment to pull latest image
aws ecs update-service \
  --cluster <CLUSTER_NAME> \
  --service wsim-backend \
  --force-new-deployment
```

### 2.5 Monitor Deployment

```bash
# Watch service events
aws ecs describe-services \
  --cluster <CLUSTER_NAME> \
  --services wsim-backend \
  --query 'services[0].events[:5]'

# Check task status
aws ecs list-tasks \
  --cluster <CLUSTER_NAME> \
  --service-name wsim-backend
```

---

## Step 3: Post-Deployment Verification

### 3.1 Verify Database Column

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'BsimEnrollment'
AND column_name = 'accessToken';
```

**Expected**: Returns one row showing `accessToken | text`.

### 3.2 Verify Container Code

Check that the new accounts endpoint exists:

```bash
aws ecs execute-command --cluster <CLUSTER_NAME> \
  --task <TASK_ID> \
  --container wsim-backend \
  --interactive \
  --command "grep -l 'fetchAccounts' /app/dist/routes/mobile.js"
```

**Expected**: File path should be returned.

### 3.3 Test Accounts Endpoint

Test with an authenticated user:

```bash
curl -X GET "https://<WSIM_API_URL>/api/mobile/accounts" \
  -H "Authorization: Bearer <USER_JWT_TOKEN>"
```

**Expected Response** (for user with enrolled banks):
```json
{
  "accounts": [
    {
      "accountId": "uuid",
      "accountType": "CHECKING",
      "displayName": "CHECKING ****1234",
      "balance": 50000,
      "currency": "CAD",
      "bankName": "Bank Simulator",
      "bankLogoUrl": null,
      "bsimId": "bsim"
    }
  ]
}
```

**Expected Response** (for user with no enrollments):
```json
{
  "accounts": []
}
```

### 3.4 Test Enrollment List API

Verify `fiUserRef` is included in enrollment list:

```bash
curl -X GET "https://<WSIM_API_URL>/api/mobile/enrollment/list" \
  -H "Authorization: Bearer <USER_JWT_TOKEN>"
```

**Expected**: Each enrollment object includes `fiUserRef` field.

---

## Step 4: Re-Enrollment Required for Existing Users

**IMPORTANT**: Existing enrolled users will need to re-enroll to:

1. Get the new `accessToken` stored (old enrollments only have `walletCredential`)
2. Get refresh tokens (requires `offline_access` scope)
3. Get correct `fiUserRef` (now uses `bsim_user_id` instead of `fi_user_ref`)

### Identifying Affected Users

```sql
SELECT id, email, COUNT(e.id) as enrollments
FROM "WalletUser" u
LEFT JOIN "BsimEnrollment" e ON e."userId" = u.id
WHERE e."accessToken" IS NULL
  AND e.id IS NOT NULL
GROUP BY u.id, u.email;
```

### User Communication

Affected users will see:
- Empty accounts list on P2P screen (until re-enrollment)
- Prompt to "Connect Bank" again

No action required from BSIM team - this is handled by mwsim app UX.

---

## Step 5: Optional - Clean Up Test Data

If testing in dev/staging, clean up test users:

```sql
-- Delete test enrollments (cascades to cards)
DELETE FROM "BsimEnrollment"
WHERE "userId" IN (
  SELECT id FROM "WalletUser"
  WHERE email LIKE 'user%@banksim.ca'
);

-- Delete test users
DELETE FROM "WalletUser"
WHERE email LIKE 'user%@banksim.ca';
```

---

## Rollback Procedure

If issues arise, rollback to previous container version:

### 1. Revert Container

```bash
# Deploy previous image tag
aws ecs update-service \
  --cluster <CLUSTER_NAME> \
  --service wsim-backend \
  --task-definition wsim-backend:<PREVIOUS_REVISION>
```

### 2. Database (No Rollback Needed)

The `accessToken` column is nullable and backward compatible:
- Old code ignores the column (doesn't read/write it)
- New code handles null values by prompting re-enrollment
- **No need to drop the column** on rollback

---

## Files Changed in This Release

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Added `accessToken String?` to BsimEnrollment |
| `backend/src/services/bsim-oidc.ts` | Added `offline_access` scope, `bsim_user_id` preference, updated account field mapping |
| `backend/src/routes/mobile.ts` | Store `accessToken` in enrollment, use for accounts fetch, expose `fiUserRef` |
| `backend/src/routes/enrollment.ts` | Store `accessToken` in web enrollment |

---

## Troubleshooting

| Symptom | Likely Cause | Solution |
|---------|--------------|----------|
| Empty accounts array | User needs re-enrollment | User disconnects and re-connects bank in mwsim |
| `accessToken` is null | Old enrollment without JWT | Re-enroll to get new token |
| `401` from BSIM Open Banking | Expired access token | Token refresh should handle; check refresh token |
| P2P transfer fails with "Account not owned" | Wrong `fiUserRef` stored | Re-enroll to get `bsim_user_id` |
| No refresh tokens issued | BSIM not seeing `offline_access` | Verify OAuth scope in BSIM logs |

---

## Related Documentation

- **BSIM Open Banking API**: Check BSIM team for `/accounts` endpoint docs
- **TransferSim P2P**: See `transferSim/LOCAL_DEPLOYMENT_PLANS/PROJECT_TRACKER.md`
- **WSIM Mobile API**: See `docs/MOBILE_APP_PAYMENT_FLOW.md`

---

## Contact

- **WSIM Issues**: Check `backend/src/routes/mobile.ts` and `backend/src/services/bsim-oidc.ts`
- **Database Issues**: Check `prisma/schema.prisma`
- **P2P Routing Issues**: Coordinate with TransferSim team

# Deployment Guide: Enhanced Purchase Info (orderDetails)

**Feature**: Enhanced Purchase Information for Mobile Payments
**Branch**: `main` (merged from `feature/enhanced-purchase-info`)
**Date**: December 2024

---

## Overview

This deployment adds the `orderDetails` field to mobile payment requests, allowing merchants to send itemized order information (line items, tax, shipping, discounts) that displays on the mwsim payment approval screen.

---

## Pre-Deployment Checklist

- [ ] Confirm WSIM `main` branch has the latest changes (commit includes `orderDetails` support)
- [ ] Confirm SSIM is also updated (must send `orderDetails` to WSIM)
- [ ] Confirm mwsim is updated (must render `orderDetails` on approval screen)
- [ ] Schedule deployment window (minimal downtime expected)

---

## Step 1: Database Schema Update

**REQUIRED**: Add the `orderDetails` column to the `mobile_payment_requests` table.

### Option A: Using Prisma (Recommended)

Run from a task with database access:

```bash
# Set DATABASE_URL environment variable, then:
npx prisma db push
```

Or if using migrations:

```bash
npx prisma migrate deploy
```

### Option B: Direct SQL (Alternative)

If Prisma is not available, run this SQL directly:

```sql
ALTER TABLE mobile_payment_requests
ADD COLUMN IF NOT EXISTS "orderDetails" JSONB;
```

### Verify Schema Update

```sql
\d mobile_payment_requests
```

**Expected**: Should show `orderDetails | jsonb` in the column list.

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

## Step 3: Deploy SSIM (If Not Already Done)

SSIM must also be updated to send `orderDetails` to WSIM.

```bash
# Similar process as WSIM:
# 1. Build SSIM container
# 2. Push to registry
# 3. Update ECS service
```

---

## Step 4: Post-Deployment Verification

### 4.1 Verify Container Code

```bash
aws ecs execute-command --cluster <CLUSTER_NAME> \
  --task <TASK_ID> \
  --container wsim-backend \
  --interactive \
  --command "ls -la /app/dist/types/"
```

**Expected**: `orderDetails.js` should be present.

### 4.2 Verify Database Column

Run via ECS one-off task:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'mobile_payment_requests'
AND column_name = 'orderDetails';
```

**Expected**: Returns one row showing `orderDetails | jsonb`.

### 4.3 Test API Endpoint

Create a test payment request with orderDetails:

```bash
curl -X POST "https://<WSIM_API_URL>/api/mobile/payment/request" \
  -H "x-api-key: <TEST_MERCHANT_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 99.99,
    "orderId": "test-deployment-123",
    "returnUrl": "https://merchant.example.com/return",
    "orderDetails": {
      "version": 1,
      "items": [{"name": "Test Item", "quantity": 1, "unitPrice": 99.99}],
      "subtotal": 99.99
    }
  }'
```

**Expected**: Returns `201 Created` with `requestId`.

### 4.4 Verify Data Storage

Query the created payment request:

```sql
SELECT id, "orderId", "orderDetails"
FROM mobile_payment_requests
WHERE "orderId" = 'test-deployment-123';
```

**Expected**: `orderDetails` column contains the JSON data.

### 4.5 Test Public Endpoint

```bash
curl "https://<WSIM_API_URL>/api/mobile/payment/<REQUEST_ID>/public"
```

**Expected**: Response includes `orderDetails` field with the JSON data.

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

The `orderDetails` column is nullable and backward compatible:
- Old code ignores the column (doesn't read/write it)
- New code handles null values gracefully
- **No need to drop the column** on rollback

---

## Files Changed in This Release

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Added `orderDetails Json?` to MobilePaymentRequest |
| `backend/src/types/orderDetails.ts` | New file - interfaces and validation |
| `backend/src/types/index.ts` | Export orderDetails types |
| `backend/src/routes/mobile.ts` | Accept, validate, store, and return orderDetails |
| `backend/src/routes/mobile.test.ts` | 9 new tests for orderDetails |
| `backend/src/test/mocks/mockPrisma.ts` | Added orderDetails to mock |

---

## Troubleshooting

| Symptom | Likely Cause | Solution |
|---------|--------------|----------|
| `orderDetails` not in response | Old container code | Rebuild and redeploy |
| Column doesn't exist error | Migration not run | Run `prisma db push` |
| Validation errors on POST | Invalid orderDetails format | Check request payload structure |
| mwsim not showing items | mwsim not updated | Deploy updated mwsim |

---

## Contact

- **WSIM Issues**: Check `backend/src/routes/mobile.ts`
- **Database Issues**: Check `prisma/schema.prisma`
- **Troubleshooting Guide**: See `docs/PRODUCTION_TROUBLESHOOTING_ORDERDETAILS.md`

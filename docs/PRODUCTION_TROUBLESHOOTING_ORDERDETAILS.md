# Production Troubleshooting: orderDetails Not Displaying

**Issue**: mwsim reports that `orderDetails` (Order Items, Price Breakdown) is not displaying on the payment approval screen.

**Date**: December 2024

---

## Quick Summary

The `orderDetails` feature was added to allow merchants to pass itemized order information (line items, tax, shipping, discounts) through the payment flow. This guide helps verify each layer of the stack in production.

---

## 1. Verify Container Code is Deployed

Check if the `orderDetails` types are present in the deployed containers.

### WSIM Backend Container

```bash
# Check if orderDetails.js exists in the backend
aws ecs execute-command --cluster <CLUSTER_NAME> \
  --task <WSIM_BACKEND_TASK_ID> \
  --container wsim-backend \
  --interactive \
  --command "ls -la /app/dist/types/"
```

**Expected output should include**: `orderDetails.js`

```bash
# Verify the file has content (not empty)
aws ecs execute-command --cluster <CLUSTER_NAME> \
  --task <WSIM_BACKEND_TASK_ID> \
  --container wsim-backend \
  --interactive \
  --command "head -20 /app/dist/types/orderDetails.js"
```

**Expected**: Should show exported interfaces and validation functions.

### SSIM Container

```bash
# Check if orderDetails.js exists in SSIM
aws ecs execute-command --cluster <CLUSTER_NAME> \
  --task <SSIM_TASK_ID> \
  --container ssim \
  --interactive \
  --command "ls -la /app/dist/types/"
```

**Expected output should include**: `orderDetails.js`

---

## 2. Verify Database Schema

Since you don't have direct `psql` access, use an ECS one-off task to run database queries.

### Check if orderDetails column exists

```bash
# Run as ECS one-off task with database access
psql $DATABASE_URL -c "\d mobile_payment_requests" | grep orderDetails
```

**Expected output**:
```
orderDetails | jsonb |
```

If the column doesn't exist, the database migration hasn't been applied.

---

## 3. Check if orderDetails Data is Being Stored

### Query recent payment requests

```bash
# Run as ECS one-off task
psql $DATABASE_URL -c "
SELECT
  id,
  \"merchantName\",
  \"orderId\",
  \"orderDetails\" IS NOT NULL as has_order_details,
  \"createdAt\"
FROM mobile_payment_requests
ORDER BY \"createdAt\" DESC
LIMIT 10;
"
```

**What to look for**:
- `has_order_details = true` means the merchant is sending orderDetails
- `has_order_details = false` means the merchant is NOT sending orderDetails

### View actual orderDetails content

```bash
# Run as ECS one-off task
psql $DATABASE_URL -c "
SELECT
  id,
  \"orderDetails\"
FROM mobile_payment_requests
WHERE \"orderDetails\" IS NOT NULL
ORDER BY \"createdAt\" DESC
LIMIT 3;
"
```

**Expected**: JSON objects like:
```json
{"items": [{"name": "Product Name", "quantity": 1, "unitPrice": 99.99}], "version": 1, "subtotal": 99.99}
```

---

## 4. Test API Endpoints

### Public Payment Endpoint (Used by mwsim)

Test the public endpoint that mwsim calls to get payment details:

```bash
# Replace with an actual pending requestId from production
curl -s "https://<WSIM_API_URL>/api/mobile/payment/<REQUEST_ID>/public" | jq .
```

**Expected response should include**:
```json
{
  "id": "...",
  "merchantName": "...",
  "amount": 99.99,
  "orderDetails": {
    "version": 1,
    "items": [...],
    "subtotal": 99.99
  }
}
```

**If `orderDetails` is missing or null**:
- Check if the merchant is actually sending orderDetails in their request
- Check SSIM logs to see if orderDetails is being passed through

---

## 5. Check Container Logs

### WSIM Backend Logs

```bash
aws logs tail /ecs/<WSIM_LOG_GROUP> --follow
```

Look for:
- Any errors related to `orderDetails`
- Payment request creation logs
- API response logs

### SSIM Logs

```bash
aws logs tail /ecs/<SSIM_LOG_GROUP> --follow
```

Look for:
- `orderDetails` being received from merchant
- `orderDetails` being forwarded to WSIM

---

## 6. Critical Check: API URL Mismatch

**IMPORTANT**: The mwsim team mentioned they're calling:
```
GET /api/wallet/payment/:requestId
```

But WSIM uses:
```
GET /api/mobile/payment/:requestId/public  (unauthenticated)
GET /api/mobile/payment/:requestId         (authenticated)
```

**Action**: Confirm with mwsim team the exact URL they're calling. If they're calling `/api/wallet/...`, that would explain why they're not getting data.

---

## Troubleshooting Decision Tree

```
1. Is orderDetails.js in the containers?
   NO  → Containers need to be rebuilt and redeployed
   YES → Continue to step 2

2. Does database have orderDetails column?
   NO  → Run: npx prisma db push (or migrate)
   YES → Continue to step 3

3. Is orderDetails data in the database?
   NO  → Check SSIM - merchant may not be sending it
   YES → Continue to step 4

4. Does API response include orderDetails?
   NO  → Check backend code/logs for serialization issues
   YES → Continue to step 5

5. Is mwsim calling the correct API URL?
   NO  → Correct the URL to /api/mobile/payment/:id/public
   YES → Issue is in mwsim rendering logic
```

---

## Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| Column doesn't exist | Migration not run | Run `npx prisma db push` or deploy migration |
| orderDetails always null | Merchant not sending it | Check merchant integration |
| API returns null orderDetails | Old container code | Rebuild and redeploy containers |
| Wrong API URL | mwsim misconfiguration | Use `/api/mobile/payment/:id/public` |

---

## Contact Points

- **WSIM Backend Issues**: Check this repo's `/backend/src/routes/mobile.ts`
- **SSIM Issues**: Check SSIM repo's payment request forwarding
- **mwsim Issues**: Check mwsim's API integration code

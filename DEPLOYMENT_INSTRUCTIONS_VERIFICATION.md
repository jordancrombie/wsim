# Deployment Instructions: Trusted User Verification Feature

**Feature Branch:** `feature/trusted-user-verification`
**Date:** 2026-01-19

---

## Overview

This deployment adds the Trusted User verification feature, which allows users to verify their identity via passport NFC scan and receive a gold checkmark on their profile.

---

## Database Changes Required

### New Tables

#### 1. `DeviceKey` - Device signing key storage
Stores public keys registered by devices for signature verification.

```sql
CREATE TABLE "device_keys" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL UNIQUE,
  "publicKey" TEXT NOT NULL,
  "keyType" TEXT NOT NULL,
  "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  FOREIGN KEY ("userId") REFERENCES "WalletUser"("id") ON DELETE CASCADE
);

CREATE INDEX "device_keys_userId_idx" ON "device_keys"("userId");
```

#### 2. `UserVerification` - Verification records
Stores verification attempt results and history.

```sql
CREATE TABLE "user_verifications" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "verificationLevel" TEXT NOT NULL,
  "documentType" TEXT NOT NULL,
  "issuingCountry" TEXT NOT NULL,
  "nameMatchScore" DOUBLE PRECISION NOT NULL,
  "faceMatchScore" DOUBLE PRECISION,
  "livenessPassed" BOOLEAN,
  "verifiedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("userId") REFERENCES "WalletUser"("id") ON DELETE CASCADE
);

CREATE INDEX "user_verifications_userId_idx" ON "user_verifications"("userId");
```

### Modified Tables

#### `WalletUser` - Add verification status fields

```sql
ALTER TABLE "WalletUser" ADD COLUMN "isVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WalletUser" ADD COLUMN "verifiedAt" TIMESTAMP(3);
ALTER TABLE "WalletUser" ADD COLUMN "verificationLevel" TEXT;
```

---

## Prisma Schema Changes

Add to `backend/prisma/schema.prisma`:

```prisma
// =============================================================================
// IDENTITY VERIFICATION (Trusted User Feature)
// =============================================================================

model DeviceKey {
  id           String      @id @default(cuid())
  userId       String
  user         WalletUser  @relation(fields: [userId], references: [id], onDelete: Cascade)
  deviceId     String      @unique
  publicKey    String      // Base64-encoded SPKI public key
  keyType      String      // "ECDSA-P256" or "RSA-2048"
  registeredAt DateTime    @default(now())
  lastUsedAt   DateTime?

  @@index([userId])
  @@map("device_keys")
}

model UserVerification {
  id                String      @id @default(cuid())
  userId            String
  user              WalletUser  @relation(fields: [userId], references: [id], onDelete: Cascade)
  deviceId          String
  verificationLevel String      // "basic" | "enhanced"
  documentType      String      // "PASSPORT"
  issuingCountry    String      // 3-letter ISO code
  nameMatchScore    Float
  faceMatchScore    Float?
  livenessPassed    Boolean?
  verifiedAt        DateTime
  expiresAt         DateTime
  createdAt         DateTime    @default(now())

  @@index([userId])
  @@map("user_verifications")
}
```

Update `WalletUser` model to add:
```prisma
model WalletUser {
  // ... existing fields ...

  // Identity verification (Trusted User feature)
  isVerified        Boolean   @default(false)
  verifiedAt        DateTime?
  verificationLevel String?   // "none" | "basic" | "enhanced"

  // ... existing relationships ...
  deviceKeys        DeviceKey[]
  verifications     UserVerification[]
}
```

---

## Deployment Steps

### 1. Pre-deployment Checks
```bash
# Verify you're on the correct branch
git checkout feature/trusted-user-verification
git pull origin feature/trusted-user-verification

# Verify database connection
npx prisma db pull --print
```

### 2. Create Migration
```bash
# Generate migration from schema changes
npx prisma migrate dev --name add_verification_tables --create-only

# Review the generated migration file
cat prisma/migrations/*_add_verification_tables/migration.sql
```

### 3. Deploy Migration (Production)
```bash
# Apply migration to production database
npx prisma migrate deploy

# Regenerate Prisma client
npx prisma generate
```

### 4. Verify Migration
```bash
# Check tables exist
psql $DATABASE_URL -c "\dt device_keys"
psql $DATABASE_URL -c "\dt user_verifications"

# Check WalletUser columns
psql $DATABASE_URL -c "\d \"WalletUser\"" | grep -E "(isVerified|verifiedAt|verificationLevel)"
```

---

## Rollback Instructions

If rollback is needed:

```bash
# Revert the migration
npx prisma migrate resolve --rolled-back add_verification_tables

# Or manually:
psql $DATABASE_URL <<EOF
DROP TABLE IF EXISTS "user_verifications";
DROP TABLE IF EXISTS "device_keys";
ALTER TABLE "WalletUser" DROP COLUMN IF EXISTS "isVerified";
ALTER TABLE "WalletUser" DROP COLUMN IF EXISTS "verifiedAt";
ALTER TABLE "WalletUser" DROP COLUMN IF EXISTS "verificationLevel";
EOF
```

---

## New Environment Variables

None required for this feature.

---

## New API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/mobile/device/register-key` | Register device public key |
| POST | `/api/mobile/verification/submit` | Submit verification result |
| DELETE | `/api/mobile/verification` | Remove verification (testing) |
| DELETE | `/api/mobile/account` | Delete account (testing) |

---

## Notes

- **Rate limiting is DISABLED** for the verification endpoint during testing phase
- Testing endpoints (`DELETE /verification`, `DELETE /account`) are intended for production testing
- No PII is stored - only verification metadata (scores, timestamps, document type)
- Verification expires after 12 months (`expiresAt` field)

---

## Contact

For questions, contact the WSIM team.

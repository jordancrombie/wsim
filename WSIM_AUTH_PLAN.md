# WSIM Authentication Improvement Plan

## Overview

Improve the WSIM wallet authentication flow to provide a proper sign-in experience with password and passkey support.

## Current State

### User Account Creation
- Users are created **during BSIM enrollment** (not during a separate signup flow)
- When a user enrolls with BSIM, the callback creates a `WalletUser` record with their email
- No password is stored - authentication relies on:
  - Session cookies (set during enrollment)
  - Email-only lookup in auth-server interaction (for OIDC flows)

### Authentication Flows
1. **Enrollment Flow**: User selects bank → redirected to BSIM → callback creates user & session
2. **OIDC Interaction Flow**: Simple email lookup (no password verification)
3. **Passkey Auth**: Full passkey infrastructure exists but only used for:
   - Popup payment confirmation
   - Not for main wallet login

### Homepage Buttons
- "Open Wallet" → `/wallet` (shows cards if session exists, empty state if not)
- "Add a Bank" → `/enroll` (starts BSIM enrollment)

---

## Proposed Changes

### Goal
Transform the homepage into a cleaner experience:
1. **"Enroll in Wallet"** - For new users (replaces "Add a Bank")
2. **"Sign in to Wallet"** - For existing users with proper authentication

### Phase 1: Homepage & Enrollment Rename

**Files to modify:**
- `frontend/src/app/page.tsx` - Rename buttons
- `frontend/src/app/enroll/page.tsx` - Update header text

**Changes:**
- "Add a Bank" → "Enroll in Wallet"
- "Open Wallet" → "Sign in to Wallet"
- Enroll page header: "Add a Bank" → "Enroll in Wallet"

### Phase 2: Add Password to User Model

**Files to modify:**
- `backend/prisma/schema.prisma` - Add passwordHash field to WalletUser
- `auth-server/prisma/schema.prisma` - Mirror the change
- Run migration

**Schema change:**
```prisma
model WalletUser {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String?  // Nullable - legacy users won't have passwords
  firstName    String?
  lastName     String?
  // ... rest unchanged
}
```

### Phase 3: Password Setup During Enrollment

**Files to modify:**
- `frontend/src/app/enroll/page.tsx` - Add password field(s) before bank selection
- `backend/src/routes/enrollment.ts` - Store password on enrollment callback

**Flow:**
1. User arrives at `/enroll`
2. Before selecting a bank, user enters:
   - Password (if new user) or
   - Option to proceed without password (passkey-only later)
3. Password is stored in session during enrollment
4. On BSIM callback, password hash is saved to user record

**Alternative (Simpler):**
- Show password setup AFTER successful enrollment on a dedicated page
- `/enroll/complete` - "Set up your wallet password" + optional passkey registration prompt

### Phase 4: Create Login Page

**New files:**
- `frontend/src/app/login/page.tsx` - Login page with email/password + passkey options

**Features:**
- Email input field
- Password input field
- "Sign in with Passkey" button
- "Forgot password?" link (future - can be placeholder)
- "Don't have an account? Enroll now" link

### Phase 5: Backend Login Endpoint

**Files to modify:**
- `backend/src/routes/auth.ts` - Add password login endpoint

**New endpoint:**
```
POST /api/auth/login
Body: { email, password }
Response: { success: true, user: {...} } or { error: 'invalid_credentials' }
```

**Logic:**
1. Find user by email
2. Compare password hash
3. Set session cookie
4. Return user info

### Phase 6: Update Homepage Flow

**Files to modify:**
- `frontend/src/app/page.tsx` - Update button destinations

**Changes:**
- "Sign in to Wallet" → `/login` (new login page)
- "Enroll in Wallet" → `/enroll`

### Phase 7: Update Wallet Page Authentication Check

**Files to modify:**
- `frontend/src/app/wallet/page.tsx` - Redirect to login if not authenticated

**Changes:**
- On 401, redirect to `/login?redirect=/wallet` instead of showing empty state
- After successful login, redirect back to wallet

---

## Implementation Order

1. **Phase 1: UI Rename** (quick win)
   - Rename buttons on homepage and enroll page
   - Immediate user clarity improvement

2. **Phase 2: Schema**
   - Add passwordHash to WalletUser
   - Run migration
   - No functional changes yet

3. **Phase 3: Login Page & Endpoint**
   - Create login page with password + passkey
   - Add backend login endpoint
   - Wire passkey auth to main login (reuse existing infrastructure)

4. **Phase 4: Password Setup**
   - Add password collection during enrollment flow
   - Hash and store on user creation

5. **Phase 5: Redirect Logic**
   - Wallet page redirects to login when unauthenticated
   - Login page redirects to wallet after success

---

## Technical Details

### Password Hashing
Use `bcrypt` (already likely available or easily added):
```typescript
import bcrypt from 'bcrypt';

const saltRounds = 12;
const hash = await bcrypt.hash(password, saltRounds);
const match = await bcrypt.compare(password, hash);
```

### Passkey Login Integration
The passkey infrastructure already exists in `backend/src/routes/passkey.ts`:
- `POST /api/passkey/authenticate/options` - Works with discoverable credentials
- `POST /api/passkey/authenticate/verify` - Sets session on success

The login page just needs to:
1. Call options endpoint (no email needed for discoverable credentials)
2. Trigger WebAuthn prompt
3. Call verify endpoint
4. Redirect on success

### Session Sharing
Backend and frontend already share sessions via cookies (`credentials: 'include'`).

---

## Files Summary

| File | Changes |
|------|---------|
| `frontend/src/app/page.tsx` | Rename buttons, update links |
| `frontend/src/app/enroll/page.tsx` | Rename header, add password step |
| `frontend/src/app/login/page.tsx` | **NEW** - Login page |
| `frontend/src/app/wallet/page.tsx` | Redirect to login on 401 |
| `backend/prisma/schema.prisma` | Add passwordHash field |
| `auth-server/prisma/schema.prisma` | Add passwordHash field |
| `backend/src/routes/auth.ts` | Add login endpoint |
| `backend/src/routes/enrollment.ts` | Store password on enrollment |

---

## Migration Notes

- Existing users won't have passwords - they can:
  - Use passkey login (if registered)
  - Re-enroll to set a password
  - Use a "set password" flow (future enhancement)

---

## Open Questions

1. **Password collection timing**: Before bank selection or after enrollment completes?
   - Recommendation: After enrollment, on a "complete your setup" page

2. **Should enrollment require password?**
   - Recommendation: No, make it optional. Users can set up passkey-only accounts.

3. **Minimum password requirements?**
   - Recommendation: 8 characters minimum, basic complexity check

---

*Created: 2024-12-05*

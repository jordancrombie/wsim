# WSIM Deployment Update - Admin Interface

> **Date**: 2025-12-06
> **For**: BSIM Team
> **Change**: Add Admin Interface to WSIM Auth Server

## Summary

This update adds an administration interface to the WSIM auth-server for managing OAuth clients. The admin interface uses passkey-only authentication (WebAuthn/FIDO2) for enhanced security.

## What's New

- **Admin Dashboard** at `/administration`
- **OAuth Client Management** - Create, edit, delete OAuth clients for SSIMs
- **Passkey Authentication** - No passwords, WebAuthn/FIDO2 security
- **Role-based Access** - ADMIN and SUPER_ADMIN roles
- **Invite System** - SUPER_ADMINs can invite new administrators

---

## Deployment Steps

### Step 1: Pull WSIM Updates

```bash
cd /path/to/wsim
git pull origin main
```

### Step 2: Update BSIM docker-compose.yml (if not already done)

The `wsim-auth-server` service needs the `AUTH_ADMIN_JWT_SECRET` environment variable. This should already be present in the BSIM docker-compose.yml:

```yaml
wsim-auth-server:
  environment:
    # ... existing variables ...
    # Admin authentication (add if missing)
    AUTH_ADMIN_JWT_SECRET: ${WSIM_AUTH_ADMIN_JWT_SECRET:-wsim-admin-secret-change-in-production}
```

**For production**, set a secure secret in your `.env` file:

```bash
# .env file in bsim directory
WSIM_AUTH_ADMIN_JWT_SECRET=your-secure-random-secret-at-least-32-chars
```

### Step 3: Run Database Migration

The admin models need to be added to the database:

```bash
# Option A: Via docker compose exec (recommended)
docker compose exec wsim-auth-server npx prisma db push

# Option B: Rebuild container (will run migrations on start)
docker compose build --no-cache wsim-auth-server
docker compose up -d wsim-auth-server
```

**New tables created:**
- `admin_users` - Administrator accounts
- `admin_passkeys` - WebAuthn credentials for admins
- `admin_invites` - Invitation codes for new admins

### Step 4: Rebuild and Restart

```bash
# From bsim directory
docker compose build wsim-auth-server
docker compose up -d wsim-auth-server
```

### Step 5: Verify Deployment

```bash
# Check container is running
docker ps | grep wsim-auth-server

# Check logs for startup
docker logs bsim-wsim-auth-server --tail 20

# Verify admin routes are accessible
curl -k https://wsim-auth.banksim.ca/administration/setup
# Should return HTML (200 OK) if no admin exists, or redirect (302) if setup complete
```

---

## First-Time Admin Setup

After deployment, the first administrator needs to be created:

1. **Navigate to setup page**:
   - Production: `https://wsim-auth.banksim.ca/administration/setup`
   - Development: `https://wsim-auth-dev.banksim.ca/administration/setup`

2. **Enter admin details**:
   - Email address
   - First name
   - Last name

3. **Register passkey**:
   - Click "Create Account & Register Passkey"
   - Follow browser prompts to create a passkey (Touch ID, Face ID, security key, etc.)

4. **Automatic login**:
   - After passkey registration, you're automatically logged in
   - Redirected to the admin dashboard

**Note**: The setup page is only accessible when no admin users exist. After the first admin is created, new admins must be invited by a SUPER_ADMIN.

---

## Environment Variables

### Required (already in docker-compose.yml)

| Variable | Description | Default |
|----------|-------------|---------|
| `AUTH_ADMIN_JWT_SECRET` | Secret for signing admin JWT tokens | `wsim-admin-secret-change-in-production` |
| `WEBAUTHN_RP_ID` | Relying Party ID for passkeys | `banksim.ca` |
| `WEBAUTHN_ORIGINS` | Allowed origins for passkey verification | (see docker-compose) |

### Production Recommendations

```bash
# Generate a secure secret
openssl rand -base64 32

# Add to .env
WSIM_AUTH_ADMIN_JWT_SECRET=<generated-secret>
```

---

## Admin Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/administration` | GET | Admin dashboard (protected) |
| `/administration/setup` | GET | First-time setup page |
| `/administration/setup` | POST | Create first admin account |
| `/administration/login` | GET | Login page |
| `/administration/login-options` | POST | Get passkey challenge |
| `/administration/login-verify` | POST | Verify passkey login |
| `/administration/logout` | GET/POST | Logout |
| `/administration/clients` | GET | OAuth clients list |
| `/administration/clients/new` | GET | Create client form |
| `/administration/clients/:id` | GET | Edit client form |

---

## Rollback Plan

If issues occur, you can rollback by:

1. **Revert WSIM to previous commit**:
   ```bash
   cd /path/to/wsim
   git checkout HEAD~1
   ```

2. **Rebuild container**:
   ```bash
   docker compose build wsim-auth-server
   docker compose up -d wsim-auth-server
   ```

The admin tables will remain in the database but won't be used. They can be removed manually if needed:

```sql
DROP TABLE IF EXISTS admin_passkeys CASCADE;
DROP TABLE IF EXISTS admin_invites CASCADE;
DROP TABLE IF EXISTS admin_users CASCADE;
```

---

## Testing Checklist

- [ ] Admin setup page loads at `/administration/setup`
- [ ] Can create first admin with passkey
- [ ] Can login with passkey at `/administration/login`
- [ ] Admin dashboard shows OAuth clients
- [ ] Can create new OAuth client
- [ ] Can edit existing OAuth client
- [ ] Can delete OAuth client
- [ ] Logout works correctly
- [ ] Non-logged-in users are redirected to login
- [ ] Existing OIDC flows still work (SSIM → WSIM payment)

---

## Troubleshooting

### "Setup already complete" error

The first admin has already been created. Use the login page instead:
- `https://wsim-auth.banksim.ca/administration/login`

### Passkey registration fails

Check WebAuthn configuration:
```bash
docker logs bsim-wsim-auth-server 2>&1 | grep -i "webauthn\|passkey\|origin"
```

Common issues:
- Origin mismatch: Ensure `WEBAUTHN_ORIGINS` includes your domain
- RP ID mismatch: Must be `banksim.ca` for `*.banksim.ca` subdomains

### "Failed to verify login" error

Check container logs for specific error:
```bash
docker logs bsim-wsim-auth-server --tail 50 2>&1 | grep -i admin
```

### Database migration issues

If Prisma can't connect:
```bash
# Check database connection
docker compose exec wsim-auth-server npx prisma db pull

# Force regenerate Prisma client
docker compose exec wsim-auth-server npx prisma generate
```

---

## Files Changed

| File | Changes |
|------|---------|
| `auth-server/src/routes/adminAuth.ts` | New admin authentication routes |
| `auth-server/src/routes/admin.ts` | Protected admin routes (clients CRUD) |
| `auth-server/src/middleware/adminAuth.ts` | JWT session management |
| `auth-server/src/views/admin/*.ejs` | Admin UI templates |
| `auth-server/prisma/schema.prisma` | AdminUser, AdminPasskey, AdminInvite models |
| `auth-server/src/config/env.ts` | AUTH_ADMIN_JWT_SECRET variable |
| `auth-server/src/index.ts` | Mount admin routes |
| `auth-server/package.json` | Added `jose` dependency |

---

## Contact

If you encounter issues during deployment, check:
1. Container logs: `docker logs bsim-wsim-auth-server`
2. WSIM CHANGELOG.md for detailed changes
3. Create an issue in the WSIM repository

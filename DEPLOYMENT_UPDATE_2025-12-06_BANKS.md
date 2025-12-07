# WSIM Deployment Update - Connected Banks Page

> **Date**: 2025-12-06
> **For**: BSIM Deployment Team
> **Change**: Add Connected Banks management page to WSIM Frontend

## Summary

This update adds a new `/banks` page to the WSIM frontend that allows users to view and manage their connected bank enrollments. Previously, the "Connected Banks" link in the profile page incorrectly sent users to the enrollment flow.

## What's New

- **Connected Banks Page** at `/banks`
  - View list of connected banks with card counts
  - Disconnect/remove bank connections
  - Link to add new banks via enrollment flow
- **Updated Navigation**
  - Profile page "Connected Banks" now goes to `/banks`
  - Footer navigation updated across all pages

---

## Deployment Steps

### Step 1: Pull WSIM Updates

```bash
cd /path/to/wsim
git pull origin main
```

### Step 2: Rebuild Frontend Container

This is a **frontend-only** change. Only the `wsim-frontend` container needs to be rebuilt.

```bash
# From the bsim directory
docker compose build wsim-frontend
docker compose up -d wsim-frontend
```

### Step 3: Verify Deployment

```bash
# Check container is running
docker ps | grep wsim-frontend

# Check logs for startup
docker logs bsim-wsim-frontend --tail 10

# Verify the /banks route is accessible
curl -k https://wsim.banksim.ca/banks
# Should return HTML (200 OK)
```

---

## No Database Changes

This update does **NOT** require any database migrations. It uses the existing `GET /api/enrollment/list` and `DELETE /api/enrollment/:id` endpoints that are already deployed.

---

## Verification Checklist

After deployment, verify:

- [ ] `/banks` page loads at `https://wsim.banksim.ca/banks`
- [ ] Page shows list of connected banks (if user is logged in)
- [ ] "Disconnect" button removes bank enrollment
- [ ] "Connect Another Bank" button goes to `/enroll`
- [ ] Profile page "Connected Banks" link goes to `/banks` (not `/enroll`)
- [ ] Footer "Banks" tab goes to `/banks` on all pages

---

## Rollback Plan

If issues occur:

```bash
# Revert to previous commit
cd /path/to/wsim
git checkout HEAD~1

# Rebuild and restart
docker compose build wsim-frontend
docker compose up -d wsim-frontend
```

---

## Files Changed

| File | Changes |
|------|---------|
| `frontend/src/app/banks/page.tsx` | **NEW** - Connected banks management page |
| `frontend/src/app/profile/page.tsx` | Updated "Connected Banks" link to `/banks` |
| `frontend/src/app/wallet/page.tsx` | Updated footer navigation |
| `frontend/src/app/enroll/page.tsx` | Updated footer navigation |
| `CHANGELOG.md` | Added changelog entry |

---

## Related API Endpoints (Already Deployed)

These backend endpoints are already in production and are used by the new page:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/enrollment/list` | GET | List user's connected banks |
| `/api/enrollment/:id` | DELETE | Remove a bank enrollment |

---

*Document created: 2025-12-06*

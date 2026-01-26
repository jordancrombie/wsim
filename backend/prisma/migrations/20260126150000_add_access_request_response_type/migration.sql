-- Add responseType field to access_requests for RFC 8628 Device Authorization
-- "credentials" = return client_id/client_secret (agent onboarding, default)
-- "token" = return access_token directly (guest checkout, one-time use)

ALTER TABLE "access_requests" ADD COLUMN "responseType" TEXT NOT NULL DEFAULT 'credentials';

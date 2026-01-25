-- Make PKCE fields nullable for confidential OAuth clients
-- Confidential clients (e.g., ChatGPT) use client_secret instead of PKCE

ALTER TABLE "oauth_authorization_codes" ALTER COLUMN "codeChallenge" DROP NOT NULL;
ALTER TABLE "oauth_authorization_codes" ALTER COLUMN "codeChallengeMethod" DROP NOT NULL;
ALTER TABLE "oauth_authorization_codes" ALTER COLUMN "codeChallengeMethod" DROP DEFAULT;

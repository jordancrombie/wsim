-- Add profile fields to WalletUser for Phase 1 User Profile feature
-- These are all nullable to maintain backwards compatibility with existing users

ALTER TABLE "WalletUser" ADD COLUMN "displayName" TEXT;
ALTER TABLE "WalletUser" ADD COLUMN "profileImageUrl" TEXT;
ALTER TABLE "WalletUser" ADD COLUMN "profileImageKey" TEXT;
ALTER TABLE "WalletUser" ADD COLUMN "initialsColor" TEXT;

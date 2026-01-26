-- Make userId nullable in pairing_codes table
-- Required for Device Authorization flow (RFC 8628) where the agent initiates
-- authorization and the user claims the code later

-- Drop the existing foreign key constraint
ALTER TABLE "pairing_codes" DROP CONSTRAINT IF EXISTS "pairing_codes_userId_fkey";

-- Make userId column nullable
ALTER TABLE "pairing_codes" ALTER COLUMN "userId" DROP NOT NULL;

-- Re-add the foreign key constraint (now allowing NULL)
ALTER TABLE "pairing_codes" ADD CONSTRAINT "pairing_codes_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "wallet_users"("id") ON DELETE CASCADE;

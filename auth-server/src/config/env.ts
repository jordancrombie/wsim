import dotenv from 'dotenv';
import path from 'path';

// Load .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3005', 10),

  // OIDC Provider
  ISSUER: process.env.ISSUER || 'http://localhost:3005',

  // Database (shared with backend)
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/wsim',

  // Backend API
  BACKEND_URL: process.env.BACKEND_URL || 'http://localhost:3003',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3004', // Public URL for browser API calls
  INTERNAL_API_SECRET: process.env.INTERNAL_API_SECRET || 'dev-internal-secret-change-in-production',

  // Cookie/Session
  COOKIE_SECRET: process.env.COOKIE_SECRET || 'dev-cookie-secret-change-in-production',

  // CORS
  CORS_ORIGINS: process.env.CORS_ORIGINS?.split(',') || [
    'http://localhost:3003',
    'http://localhost:3004',
  ],

  // Popup/Embed allowed origins (for postMessage)
  ALLOWED_POPUP_ORIGINS: process.env.ALLOWED_POPUP_ORIGINS?.split(',') || [
    'http://localhost:3000',
    'https://ssim-dev.banksim.ca',
  ],

  // WebAuthn / Passkeys
  WEBAUTHN_RP_NAME: process.env.WEBAUTHN_RP_NAME || 'WSIM Wallet',
  WEBAUTHN_RP_ID: process.env.WEBAUTHN_RP_ID || 'localhost',
  WEBAUTHN_ORIGIN: process.env.WEBAUTHN_ORIGIN || 'http://localhost:3005',
};

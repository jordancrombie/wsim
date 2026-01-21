import dotenv from 'dotenv';
import path from 'path';

// Load .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const env = {
  // Server
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3003', 10),

  // URLs
  APP_URL: process.env.APP_URL || 'http://localhost:3003',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3004',
  AUTH_SERVER_URL: process.env.AUTH_SERVER_URL || 'http://localhost:3005',

  // Database
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/wsim',

  // Security
  JWT_SECRET: process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production',
  SESSION_SECRET: process.env.SESSION_SECRET || 'dev-session-secret-change-in-production',
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef', // 32 bytes for AES-256

  // Mobile API
  MOBILE_JWT_SECRET: process.env.MOBILE_JWT_SECRET || 'dev-mobile-jwt-secret-change-in-production',
  MOBILE_ACCESS_TOKEN_EXPIRY: parseInt(process.env.MOBILE_ACCESS_TOKEN_EXPIRY || '3600', 10), // 1 hour
  MOBILE_REFRESH_TOKEN_EXPIRY: parseInt(process.env.MOBILE_REFRESH_TOKEN_EXPIRY || '2592000', 10), // 30 days
  MOBILE_DEVICE_CREDENTIAL_EXPIRY: parseInt(process.env.MOBILE_DEVICE_CREDENTIAL_EXPIRY || '7776000', 10), // 90 days

  // BSIM Providers (JSON array)
  BSIM_PROVIDERS: process.env.BSIM_PROVIDERS || '[]',

  // Internal API (auth-server to backend communication)
  INTERNAL_API_SECRET: process.env.INTERNAL_API_SECRET || 'dev-internal-secret-change-in-production',

  // AWS S3 / CloudFront (Profile Images)
  AWS_REGION: process.env.AWS_REGION || 'ca-central-1',
  AWS_S3_BUCKET_PROFILES: process.env.AWS_S3_BUCKET_PROFILES || 'banksim-profiles-wsim',
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || '',
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || '',
  CDN_BASE_URL: process.env.CDN_BASE_URL || 'https://cdn.banksim.ca',

  // Profile image settings
  PROFILE_IMAGE_MAX_SIZE_MB: parseInt(process.env.PROFILE_IMAGE_MAX_SIZE_MB || '5', 10),
  PROFILE_IMAGE_UPLOAD_RATE_LIMIT: parseInt(process.env.PROFILE_IMAGE_UPLOAD_RATE_LIMIT || '100', 10), // per user per hour

  // CORS
  CORS_ORIGINS: process.env.CORS_ORIGINS?.split(',') || [
    'http://localhost:3004',
    'http://localhost:3005',
  ],

  // ContractSim Integration
  CONTRACTSIM_API_URL: process.env.CONTRACTSIM_API_URL || 'http://localhost:3007',
  CONTRACTSIM_API_KEY: process.env.CONTRACTSIM_API_KEY || 'dev-contractsim-key',
  CONTRACTSIM_WEBHOOK_SECRET: process.env.CONTRACTSIM_WEBHOOK_SECRET || 'dev-contractsim-webhook-secret',

  // TransferSim Integration (for alias resolution)
  TRANSFERSIM_API_URL: process.env.TRANSFERSIM_API_URL || 'http://localhost:3006',
  TRANSFERSIM_API_KEY: process.env.TRANSFERSIM_API_KEY || 'dev-transfersim-key',

  // WebAuthn / Passkeys
  WEBAUTHN_RP_NAME: process.env.WEBAUTHN_RP_NAME || 'WSIM Wallet',
  WEBAUTHN_RP_ID: process.env.WEBAUTHN_RP_ID || 'localhost',
  // Support multiple origins for passkey verification (frontend + auth-server popup)
  WEBAUTHN_ORIGINS: process.env.WEBAUTHN_ORIGINS?.split(',') ||
    (process.env.WEBAUTHN_ORIGIN ? [process.env.WEBAUTHN_ORIGIN] : ['http://localhost:3004']),

  // Agent Commerce (SACP)
  AGENT_JWT_SECRET: process.env.AGENT_JWT_SECRET || 'dev-agent-jwt-secret-change-in-production',
  AGENT_ACCESS_TOKEN_EXPIRY: parseInt(process.env.AGENT_ACCESS_TOKEN_EXPIRY || '3600', 10), // 1 hour
  PAYMENT_TOKEN_SECRET: process.env.PAYMENT_TOKEN_SECRET || 'dev-payment-token-secret-change-in-production',
  PAYMENT_TOKEN_EXPIRY: parseInt(process.env.PAYMENT_TOKEN_EXPIRY || '300', 10), // 5 minutes
  STEP_UP_EXPIRY_MINUTES: parseInt(process.env.STEP_UP_EXPIRY_MINUTES || '15', 10),
  DAILY_LIMIT_RESET_TIMEZONE: process.env.DAILY_LIMIT_RESET_TIMEZONE || 'America/Toronto',

  // Introspection credentials for merchants (SSIM)
  INTROSPECTION_CLIENT_ID: process.env.INTROSPECTION_CLIENT_ID || 'ssim_introspect',
  INTROSPECTION_CLIENT_SECRET: process.env.INTROSPECTION_CLIENT_SECRET || 'dev-introspection-secret-change-in-production',
};

// Validate required env vars in production
export function validateEnv(): void {
  if (env.NODE_ENV === 'production') {
    const required = [
      'DATABASE_URL',
      'JWT_SECRET',
      'SESSION_SECRET',
      'ENCRYPTION_KEY',
      'MOBILE_JWT_SECRET',
      'AGENT_JWT_SECRET',
      'PAYMENT_TOKEN_SECRET',
      'INTROSPECTION_CLIENT_SECRET',
    ];

    const missing = required.filter(key => !process.env[key]);

    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    // Validate encryption key length
    if (env.ENCRYPTION_KEY.length !== 32) {
      throw new Error('ENCRYPTION_KEY must be exactly 32 characters (256 bits)');
    }
  }
}

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

  // BSIM Providers (JSON array)
  BSIM_PROVIDERS: process.env.BSIM_PROVIDERS || '[]',

  // Internal API (auth-server to backend communication)
  INTERNAL_API_SECRET: process.env.INTERNAL_API_SECRET || 'dev-internal-secret-change-in-production',

  // CORS
  CORS_ORIGINS: process.env.CORS_ORIGINS?.split(',') || [
    'http://localhost:3004',
    'http://localhost:3005',
  ],
};

// Validate required env vars in production
export function validateEnv(): void {
  if (env.NODE_ENV === 'production') {
    const required = [
      'DATABASE_URL',
      'JWT_SECRET',
      'SESSION_SECRET',
      'ENCRYPTION_KEY',
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

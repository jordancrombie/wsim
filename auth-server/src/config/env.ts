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

  // Cookie/Session
  COOKIE_SECRET: process.env.COOKIE_SECRET || 'dev-cookie-secret-change-in-production',

  // CORS
  CORS_ORIGINS: process.env.CORS_ORIGINS?.split(',') || [
    'http://localhost:3003',
    'http://localhost:3004',
  ],
};

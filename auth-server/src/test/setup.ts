import { beforeEach, vi } from 'vitest';

// Set up test environment variables
process.env.NODE_ENV = 'test';
process.env.PORT = '3005';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.ISSUER = 'https://wsim-auth-test.banksim.ca';
process.env.BACKEND_URL = 'http://localhost:3003';
process.env.COOKIE_SECRET = 'test-cookie-secret-32-chars-long!';
process.env.AUTH_ADMIN_JWT_SECRET = 'test-admin-jwt-secret-32-chars!!';
process.env.CORS_ORIGINS = 'https://wsim-test.banksim.ca';
process.env.WEBAUTHN_RP_ID = 'banksim.ca';
process.env.WEBAUTHN_ORIGINS = 'https://wsim-auth-test.banksim.ca';
process.env.ALLOWED_EMBED_ORIGINS = 'https://ssim-test.banksim.ca';

// Clear all mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});

import { beforeEach, vi } from 'vitest';

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-32-chars-long!!!';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';

// Reset all mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});

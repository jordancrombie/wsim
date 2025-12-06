import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import {
  requireAuth,
  optionalAuth,
  generateJwt,
  verifyJwt,
} from './auth';

// Mock Prisma
vi.mock('../config/database', () => ({
  prisma: {
    walletUser: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from '../config/database';

describe('generateJwt', () => {
  it('should generate a valid JWT token', () => {
    const token = generateJwt('user-123');

    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');
    // JWT format: header.payload.signature
    expect(token.split('.')).toHaveLength(3);
  });

  it('should generate tokens that can be verified', () => {
    const userId = 'user-456';
    const token = generateJwt(userId);
    const verified = verifyJwt(token);

    expect(verified).not.toBeNull();
    expect(verified?.sub).toBe(userId);
  });

  it('should generate different tokens for different users', () => {
    const token1 = generateJwt('user-1');
    const token2 = generateJwt('user-2');

    expect(token1).not.toBe(token2);
  });

  it('should accept custom expiration time', () => {
    const token = generateJwt('user-123', '2h');

    expect(token).toBeTruthy();
    const verified = verifyJwt(token);
    expect(verified).not.toBeNull();
  });

  it('should accept numeric expiration time', () => {
    const token = generateJwt('user-123', 3600);

    expect(token).toBeTruthy();
    const verified = verifyJwt(token);
    expect(verified).not.toBeNull();
  });
});

describe('verifyJwt', () => {
  it('should return payload for valid token', () => {
    const userId = 'test-user-id';
    const token = generateJwt(userId);
    const result = verifyJwt(token);

    expect(result).not.toBeNull();
    expect(result?.sub).toBe(userId);
  });

  it('should return null for invalid token', () => {
    const result = verifyJwt('invalid-token');
    expect(result).toBeNull();
  });

  it('should return null for empty token', () => {
    const result = verifyJwt('');
    expect(result).toBeNull();
  });

  it('should return null for malformed JWT', () => {
    const result = verifyJwt('not.a.valid.jwt.token');
    expect(result).toBeNull();
  });

  it('should return null for tampered token', () => {
    const token = generateJwt('user-123');
    // Tamper with the signature
    const parts = token.split('.');
    parts[2] = 'tampered' + parts[2].slice(8);
    const tamperedToken = parts.join('.');

    const result = verifyJwt(tamperedToken);
    expect(result).toBeNull();
  });
});

describe('requireAuth middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {
      session: {} as any,
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    mockNext = vi.fn();
    vi.clearAllMocks();
  });

  it('should return 401 if no session userId', async () => {
    mockReq.session = {} as any;

    await requireAuth(
      mockReq as Request,
      mockRes as Response,
      mockNext
    );

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'unauthorized',
      message: 'Authentication required',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 401 if session is undefined', async () => {
    mockReq.session = undefined as any;

    await requireAuth(
      mockReq as Request,
      mockRes as Response,
      mockNext
    );

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 401 if user not found in database', async () => {
    const mockDestroy = vi.fn((cb: () => void) => cb());
    mockReq.session = {
      userId: 'deleted-user',
      destroy: mockDestroy,
    } as any;

    (prisma.walletUser.findUnique as Mock).mockResolvedValue(null);

    await requireAuth(
      mockReq as Request,
      mockRes as Response,
      mockNext
    );

    expect(prisma.walletUser.findUnique).toHaveBeenCalledWith({
      where: { id: 'deleted-user' },
      select: { id: true, email: true, walletId: true },
    });
    expect(mockDestroy).toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'unauthorized',
      message: 'User not found',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should call next and attach user to request if valid', async () => {
    mockReq.session = {
      userId: 'valid-user',
    } as any;

    const mockUser = {
      id: 'valid-user',
      email: 'user@example.com',
      walletId: 'wallet-123',
    };
    (prisma.walletUser.findUnique as Mock).mockResolvedValue(mockUser);

    await requireAuth(
      mockReq as Request,
      mockRes as Response,
      mockNext
    );

    expect(mockNext).toHaveBeenCalled();
    expect(mockReq.userId).toBe('valid-user');
    expect(mockReq.user).toEqual(mockUser);
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it('should return 500 on database error', async () => {
    mockReq.session = {
      userId: 'user-123',
    } as any;

    (prisma.walletUser.findUnique as Mock).mockRejectedValue(new Error('Database error'));

    // Suppress console.error for this test
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await requireAuth(
      mockReq as Request,
      mockRes as Response,
      mockNext
    );

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'internal_error',
      message: 'Authentication error',
    });
    expect(mockNext).not.toHaveBeenCalled();

    consoleError.mockRestore();
  });
});

describe('optionalAuth middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {
      session: {} as any,
    };
    mockRes = {};
    mockNext = vi.fn();
    vi.clearAllMocks();
  });

  it('should call next without user if no session', async () => {
    mockReq.session = {} as any;

    await optionalAuth(
      mockReq as Request,
      mockRes as Response,
      mockNext
    );

    expect(mockNext).toHaveBeenCalled();
    expect(mockReq.userId).toBeUndefined();
    expect(mockReq.user).toBeUndefined();
  });

  it('should call next without user if session userId is undefined', async () => {
    mockReq.session = { userId: undefined } as any;

    await optionalAuth(
      mockReq as Request,
      mockRes as Response,
      mockNext
    );

    expect(mockNext).toHaveBeenCalled();
    expect(mockReq.userId).toBeUndefined();
  });

  it('should call next without user if user not found', async () => {
    mockReq.session = { userId: 'missing-user' } as any;

    (prisma.walletUser.findUnique as Mock).mockResolvedValue(null);

    await optionalAuth(
      mockReq as Request,
      mockRes as Response,
      mockNext
    );

    expect(mockNext).toHaveBeenCalled();
    expect(mockReq.userId).toBeUndefined();
    expect(mockReq.user).toBeUndefined();
  });

  it('should attach user to request if found', async () => {
    mockReq.session = { userId: 'valid-user' } as any;

    const mockUser = {
      id: 'valid-user',
      email: 'user@example.com',
      walletId: 'wallet-456',
    };
    (prisma.walletUser.findUnique as Mock).mockResolvedValue(mockUser);

    await optionalAuth(
      mockReq as Request,
      mockRes as Response,
      mockNext
    );

    expect(mockNext).toHaveBeenCalled();
    expect(mockReq.userId).toBe('valid-user');
    expect(mockReq.user).toEqual(mockUser);
  });

  it('should call next on database error without throwing', async () => {
    mockReq.session = { userId: 'user-123' } as any;

    (prisma.walletUser.findUnique as Mock).mockRejectedValue(new Error('Database error'));

    // Suppress console.error for this test
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await optionalAuth(
      mockReq as Request,
      mockRes as Response,
      mockNext
    );

    expect(mockNext).toHaveBeenCalled();
    expect(mockReq.userId).toBeUndefined();

    consoleError.mockRestore();
  });
});

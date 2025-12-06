import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import {
  createAdminToken,
  verifyAdminToken,
  requireAdminAuth,
  setAdminCookie,
  clearAdminCookie,
  AdminSession,
} from './adminAuth';

// Mock Prisma
vi.mock('../adapters/prisma', () => ({
  prisma: {
    adminUser: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from '../adapters/prisma';

describe('createAdminToken', () => {
  it('should create a valid JWT token', async () => {
    const session: AdminSession = {
      userId: 'user-123',
      email: 'admin@example.com',
      role: 'ADMIN',
    };

    const token = await createAdminToken(session);

    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');
    // JWT format: header.payload.signature
    expect(token.split('.')).toHaveLength(3);
  });

  it('should create tokens that can be verified', async () => {
    const session: AdminSession = {
      userId: 'user-456',
      email: 'super@example.com',
      role: 'SUPER_ADMIN',
    };

    const token = await createAdminToken(session);
    const verified = await verifyAdminToken(token);

    expect(verified).not.toBeNull();
    expect(verified?.userId).toBe(session.userId);
    expect(verified?.email).toBe(session.email);
    expect(verified?.role).toBe(session.role);
  });

  it('should create different tokens for different sessions', async () => {
    const session1: AdminSession = {
      userId: 'user-1',
      email: 'admin1@example.com',
      role: 'ADMIN',
    };
    const session2: AdminSession = {
      userId: 'user-2',
      email: 'admin2@example.com',
      role: 'ADMIN',
    };

    const token1 = await createAdminToken(session1);
    const token2 = await createAdminToken(session2);

    expect(token1).not.toBe(token2);
  });
});

describe('verifyAdminToken', () => {
  it('should return session data for valid token', async () => {
    const session: AdminSession = {
      userId: 'test-user-id',
      email: 'test@example.com',
      role: 'ADMIN',
    };

    const token = await createAdminToken(session);
    const result = await verifyAdminToken(token);

    expect(result).not.toBeNull();
    expect(result?.userId).toBe(session.userId);
    expect(result?.email).toBe(session.email);
    expect(result?.role).toBe(session.role);
  });

  it('should return null for invalid token', async () => {
    const result = await verifyAdminToken('invalid-token');
    expect(result).toBeNull();
  });

  it('should return null for empty token', async () => {
    const result = await verifyAdminToken('');
    expect(result).toBeNull();
  });

  it('should return null for malformed JWT', async () => {
    const result = await verifyAdminToken('not.a.valid.jwt.token');
    expect(result).toBeNull();
  });

  it('should return null for tampered token', async () => {
    const session: AdminSession = {
      userId: 'user-123',
      email: 'admin@example.com',
      role: 'ADMIN',
    };

    const token = await createAdminToken(session);
    // Tamper with the signature
    const parts = token.split('.');
    parts[2] = 'tampered' + parts[2].slice(8);
    const tamperedToken = parts.join('.');

    const result = await verifyAdminToken(tamperedToken);
    expect(result).toBeNull();
  });
});

describe('requireAdminAuth middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {
      cookies: {},
    };
    mockRes = {
      redirect: vi.fn().mockReturnThis(),
      clearCookie: vi.fn().mockReturnThis(),
    };
    mockNext = vi.fn();
    vi.clearAllMocks();
  });

  it('should redirect to login if no token cookie', async () => {
    await requireAdminAuth(
      mockReq as Request,
      mockRes as Response,
      mockNext
    );

    expect(mockRes.redirect).toHaveBeenCalledWith('/administration/login');
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should redirect to login if token is invalid', async () => {
    mockReq.cookies = { wsim_admin_token: 'invalid-token' };

    await requireAdminAuth(
      mockReq as Request,
      mockRes as Response,
      mockNext
    );

    expect(mockRes.clearCookie).toHaveBeenCalledWith('wsim_admin_token');
    expect(mockRes.redirect).toHaveBeenCalledWith('/administration/login');
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should redirect to login if admin not found in database', async () => {
    const session: AdminSession = {
      userId: 'deleted-user',
      email: 'deleted@example.com',
      role: 'ADMIN',
    };
    const token = await createAdminToken(session);
    mockReq.cookies = { wsim_admin_token: token };

    (prisma.adminUser.findUnique as Mock).mockResolvedValue(null);

    await requireAdminAuth(
      mockReq as Request,
      mockRes as Response,
      mockNext
    );

    expect(prisma.adminUser.findUnique).toHaveBeenCalledWith({
      where: { id: 'deleted-user' },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
      },
    });
    expect(mockRes.clearCookie).toHaveBeenCalledWith('wsim_admin_token');
    expect(mockRes.redirect).toHaveBeenCalledWith('/administration/login');
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should call next and attach admin to request if valid', async () => {
    const session: AdminSession = {
      userId: 'valid-user',
      email: 'valid@example.com',
      role: 'ADMIN',
    };
    const token = await createAdminToken(session);
    mockReq.cookies = { wsim_admin_token: token };

    const mockAdmin = {
      id: 'valid-user',
      email: 'valid@example.com',
      firstName: 'Test',
      lastName: 'Admin',
      role: 'ADMIN',
    };
    (prisma.adminUser.findUnique as Mock).mockResolvedValue(mockAdmin);

    await requireAdminAuth(
      mockReq as Request,
      mockRes as Response,
      mockNext
    );

    expect(mockNext).toHaveBeenCalled();
    expect((mockReq as any).admin).toEqual(mockAdmin);
    expect(mockRes.redirect).not.toHaveBeenCalled();
  });

  it('should verify SUPER_ADMIN role correctly', async () => {
    const session: AdminSession = {
      userId: 'super-admin-user',
      email: 'super@example.com',
      role: 'SUPER_ADMIN',
    };
    const token = await createAdminToken(session);
    mockReq.cookies = { wsim_admin_token: token };

    const mockAdmin = {
      id: 'super-admin-user',
      email: 'super@example.com',
      firstName: 'Super',
      lastName: 'Admin',
      role: 'SUPER_ADMIN',
    };
    (prisma.adminUser.findUnique as Mock).mockResolvedValue(mockAdmin);

    await requireAdminAuth(
      mockReq as Request,
      mockRes as Response,
      mockNext
    );

    expect(mockNext).toHaveBeenCalled();
    expect((mockReq as any).admin.role).toBe('SUPER_ADMIN');
  });
});

describe('setAdminCookie', () => {
  it('should set cookie with correct options', () => {
    const mockRes = {
      cookie: vi.fn().mockReturnThis(),
    } as Partial<Response>;

    const token = 'test-token';
    setAdminCookie(mockRes as Response, token);

    expect(mockRes.cookie).toHaveBeenCalledWith('wsim_admin_token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
    });
  });
});

describe('clearAdminCookie', () => {
  it('should clear cookie with correct options', () => {
    const mockRes = {
      clearCookie: vi.fn().mockReturnThis(),
    } as Partial<Response>;

    clearAdminCookie(mockRes as Response);

    expect(mockRes.clearCookie).toHaveBeenCalledWith('wsim_admin_token', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
  });
});

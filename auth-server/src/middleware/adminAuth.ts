import { Request, Response, NextFunction } from 'express';
import { SignJWT, jwtVerify, JWTPayload } from 'jose';
import { prisma } from '../adapters/prisma';
import { env } from '../config/env';

const JWT_SECRET = new TextEncoder().encode(
  env.AUTH_ADMIN_JWT_SECRET
);
const JWT_EXPIRES_IN = '7d';
const COOKIE_NAME = 'wsim_admin_token';

export interface AdminSession {
  userId: string;
  email: string;
  role: string;
}

export async function createAdminToken(session: AdminSession): Promise<string> {
  const payload: JWTPayload = {
    userId: session.userId,
    email: session.email,
    role: session.role,
  };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRES_IN)
    .sign(JWT_SECRET);
}

export async function verifyAdminToken(token: string): Promise<AdminSession | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as AdminSession;
  } catch {
    return null;
  }
}

export async function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies[COOKIE_NAME];

  if (!token) {
    return res.redirect('/administration/login');
  }

  const session = await verifyAdminToken(token);
  if (!session) {
    res.clearCookie(COOKIE_NAME);
    return res.redirect('/administration/login');
  }

  // Verify admin still exists in database
  const admin = await prisma.adminUser.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
    },
  });

  if (!admin) {
    res.clearCookie(COOKIE_NAME);
    return res.redirect('/administration/login');
  }

  // Attach admin to request
  (req as any).admin = admin;
  next();
}

export function setAdminCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
  });
}

export function clearAdminCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  });
}

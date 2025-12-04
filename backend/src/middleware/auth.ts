import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from '../config/database';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      user?: {
        id: string;
        email: string;
        walletId: string;
      };
    }
  }
}

// Extend express-session
declare module 'express-session' {
  interface SessionData {
    userId?: string;
    enrollmentState?: {
      bsimId: string;
      state: string;
      nonce: string;
      codeVerifier: string;
    };
    paymentState?: {
      merchantId: string;
      amount: string;
      currency: string;
      orderId: string;
      state: string;
      nonce: string;
    };
  }
}

/**
 * Middleware to require authenticated session
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.session?.userId;

    if (!userId) {
      res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
      return;
    }

    const user = await prisma.walletUser.findUnique({
      where: { id: userId },
      select: { id: true, email: true, walletId: true },
    });

    if (!user) {
      req.session.destroy(() => {});
      res.status(401).json({ error: 'unauthorized', message: 'User not found' });
      return;
    }

    req.userId = user.id;
    req.user = user;
    next();
  } catch (error) {
    console.error('[Auth] Error:', error);
    res.status(500).json({ error: 'internal_error', message: 'Authentication error' });
  }
}

/**
 * Middleware to optionally load user if session exists
 */
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.session?.userId;

    if (userId) {
      const user = await prisma.walletUser.findUnique({
        where: { id: userId },
        select: { id: true, email: true, walletId: true },
      });

      if (user) {
        req.userId = user.id;
        req.user = user;
      }
    }

    next();
  } catch (error) {
    console.error('[Auth] Optional auth error:', error);
    next();
  }
}

/**
 * Generate a JWT token for API access
 */
export function generateJwt(userId: string, expiresIn: string | number = '1h'): string {
  return jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: expiresIn as jwt.SignOptions['expiresIn'] });
}

/**
 * Verify a JWT token
 */
export function verifyJwt(token: string): { sub: string } | null {
  try {
    return jwt.verify(token, env.JWT_SECRET) as { sub: string };
  } catch {
    return null;
  }
}

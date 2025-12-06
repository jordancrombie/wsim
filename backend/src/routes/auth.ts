import { Router } from 'express';
import bcrypt from 'bcrypt';
import { requireAuth, optionalAuth } from '../middleware/auth';
import { env } from '../config/env';
import { prisma } from '../config/database';

const router = Router();

/**
 * GET /api/auth/me
 * Get current authenticated user
 */
router.get('/me', optionalAuth, (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'unauthorized', message: 'Not authenticated' });
    return;
  }

  res.json({
    id: req.user.id,
    email: req.user.email,
    walletId: req.user.walletId,
  });
});

/**
 * POST /api/auth/logout
 * Log out the current user
 */
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('[Auth] Logout error:', err);
      res.status(500).json({ error: 'internal_error', message: 'Logout failed' });
      return;
    }

    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

/**
 * GET /api/auth/session
 * Check if user has an active session
 */
router.get('/session', optionalAuth, (req, res) => {
  res.json({
    authenticated: !!req.user,
    user: req.user ? {
      id: req.user.id,
      email: req.user.email,
      walletId: req.user.walletId,
    } : null,
  });
});

/**
 * POST /api/auth/login
 * Login with email and password
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({
        error: 'validation_error',
        message: 'Email and password are required',
      });
      return;
    }

    // Find user by email
    const user = await prisma.walletUser.findUnique({
      where: { email: email.toLowerCase().trim() },
      select: {
        id: true,
        email: true,
        walletId: true,
        passwordHash: true,
        firstName: true,
        lastName: true,
      },
    });

    if (!user) {
      console.log(`[Auth] Login failed: user not found for ${email}`);
      res.status(401).json({
        error: 'invalid_credentials',
        message: 'Invalid email or password',
      });
      return;
    }

    // Check if user has a password set
    if (!user.passwordHash) {
      console.log(`[Auth] Login failed: no password set for ${email}`);
      res.status(401).json({
        error: 'no_password',
        message: 'No password set for this account. Please use passkey login or re-enroll to set a password.',
      });
      return;
    }

    // Verify password
    const passwordValid = await bcrypt.compare(password, user.passwordHash);

    if (!passwordValid) {
      console.log(`[Auth] Login failed: invalid password for ${email}`);
      res.status(401).json({
        error: 'invalid_credentials',
        message: 'Invalid email or password',
      });
      return;
    }

    // Set session
    req.session.userId = user.id;

    console.log(`[Auth] Login successful for ${email}`);

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        walletId: user.walletId,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    });
  } catch (error) {
    console.error('[Auth] Login error:', error);
    res.status(500).json({
      error: 'internal_error',
      message: 'Login failed',
    });
  }
});

export default router;

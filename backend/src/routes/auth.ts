import { Router } from 'express';
import { requireAuth, optionalAuth } from '../middleware/auth';
import { env } from '../config/env';

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

export default router;

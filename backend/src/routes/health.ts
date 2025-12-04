import { Router } from 'express';
import { prisma } from '../config/database';

const router = Router();

/**
 * Health check endpoint
 */
router.get('/', async (req, res) => {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'wsim-backend',
      version: process.env.npm_package_version || '0.1.0',
    });
  } catch (error) {
    console.error('[Health] Database check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      service: 'wsim-backend',
      error: 'Database connection failed',
    });
  }
});

/**
 * Readiness check - is the service ready to accept traffic?
 */
router.get('/ready', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ready: true });
  } catch {
    res.status(503).json({ ready: false });
  }
});

/**
 * Liveness check - is the service alive?
 */
router.get('/live', (req, res) => {
  res.json({ alive: true });
});

export default router;

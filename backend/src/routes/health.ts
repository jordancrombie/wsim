import { Router } from 'express';
import { prisma } from '../config/database';
import packageJson from '../../package.json';

const router = Router();

// Version from package.json
const VERSION = packageJson.version;
const COMPATIBILITY = {
  // Minimum versions required for full functionality
  bsim: {
    minimum: '0.4.0', // Requires bsim_user_id claim support
    features: {
      'wallet:enroll': '0.1.0',
      'fdx:accountdetailed:read': '0.3.0',
      'bsim_user_id claim': '0.4.0',
    },
  },
  transferSim: {
    minimum: '0.2.0', // Required for P2P transfers
    features: {
      'p2p-transfers': '0.2.0',
    },
  },
  mwsim: {
    minimum: '0.3.0', // Mobile app integration
    features: {
      'mobile-payments': '0.3.0',
      'p2p-accounts': '0.4.0',
    },
  },
};

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
      version: VERSION,
      compatibility: COMPATIBILITY,
    });
  } catch (error) {
    console.error('[Health] Database check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      service: 'wsim-backend',
      version: VERSION,
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

import { Router } from 'express';
import healthRoutes from './health';
import authRoutes from './auth';
import walletRoutes from './wallet';
import enrollmentRoutes from './enrollment';

const router = Router();

// Mount route modules
router.use('/health', healthRoutes);
router.use('/api/auth', authRoutes);
router.use('/api/wallet', walletRoutes);
router.use('/api/enrollment', enrollmentRoutes);

export default router;

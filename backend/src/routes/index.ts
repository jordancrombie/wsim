import { Router } from 'express';
import healthRoutes from './health';
import authRoutes from './auth';
import walletRoutes from './wallet';
import enrollmentRoutes from './enrollment';
import paymentRoutes from './payment';
import passkeyRoutes from './passkey';
import walletApiRoutes from './wallet-api';
import partnerRoutes from './partner';
import mobileRoutes from './mobile';
import webhookRoutes from './webhooks';

const router = Router();

// Mount route modules
router.use('/health', healthRoutes);
router.use('/api/health', healthRoutes); // Also expose health at /api/health for ALB routing
router.use('/api/auth', authRoutes);
router.use('/api/wallet', walletRoutes);
router.use('/api/enrollment', enrollmentRoutes);
router.use('/api/payment', paymentRoutes);
router.use('/api/passkey', passkeyRoutes);
router.use('/api/merchant', walletApiRoutes);
router.use('/api/partner', partnerRoutes); // Server-to-server partner integrations (BSIM SSO)
router.use('/api/mobile', mobileRoutes); // Mobile app API (mwsim)
router.use('/api/webhooks', webhookRoutes); // Internal webhooks (TransferSim, etc.)

export default router;

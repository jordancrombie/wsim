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
import profileRoutes, { internalProfileRouter } from './profile';
import contractRoutes, { internalContractsRouter } from './contracts';
import verificationRoutes from './verification';

// Agent Commerce (SACP)
import agentOAuthRoutes from './agent-oauth';
import agentPaymentsRoutes from './agent-payments';
import agentManagementRoutes from './agent-management';
import stepUpRoutes from './step-up';

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
router.use('/api/mobile/profile', profileRoutes); // Mobile profile API (Phase 1 User Profile)
router.use('/api/webhooks', webhookRoutes); // Internal webhooks (TransferSim, etc.)
router.use('/api/internal/profile', internalProfileRouter); // Internal API for TransferSim
router.use('/api/mobile/contracts', contractRoutes); // Contract proxy API (ContractSim)
router.use('/api/internal/contracts', internalContractsRouter); // Internal API for ContractSim
router.use('/api/mobile', verificationRoutes); // Verification API (Trusted User feature)

// Agent Commerce (SACP) routes
router.use('/api/agent/v1/oauth', agentOAuthRoutes);     // Agent OAuth endpoints
router.use('/api/agent/v1/payments', agentPaymentsRoutes); // Agent payment token API
router.use('/api/mobile/agents', agentManagementRoutes); // Mobile app agent management
router.use('/api/mobile/step-up', stepUpRoutes);         // Mobile step-up approval

export default router;

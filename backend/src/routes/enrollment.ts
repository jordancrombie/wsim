import { Router } from 'express';
import { optionalAuth, requireAuth } from '../middleware/auth';
import { env } from '../config/env';

const router = Router();

// BSIM provider configuration type
interface BsimProviderConfig {
  bsimId: string;
  name: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  logoUrl?: string;
}

// Parse BSIM providers from environment
function getBsimProviders(): BsimProviderConfig[] {
  try {
    return JSON.parse(env.BSIM_PROVIDERS);
  } catch {
    console.warn('[Enrollment] Failed to parse BSIM_PROVIDERS');
    return [];
  }
}

/**
 * GET /api/enrollment/banks
 * List available banks for enrollment
 */
router.get('/banks', optionalAuth, (req, res) => {
  const providers = getBsimProviders();

  res.json({
    banks: providers.map(p => ({
      bsimId: p.bsimId,
      name: p.name || p.bsimId,
      logoUrl: p.logoUrl,
    })),
  });
});

/**
 * POST /api/enrollment/start/:bsimId
 * Initiate enrollment with a bank
 *
 * NOTE: Full implementation requires BSIM wallet:enroll scope to be available.
 * This is a placeholder that sets up the session state.
 */
router.post('/start/:bsimId', optionalAuth, async (req, res) => {
  const { bsimId } = req.params;

  const providers = getBsimProviders();
  const provider = providers.find(p => p.bsimId === bsimId);

  if (!provider) {
    res.status(404).json({ error: 'not_found', message: 'Bank not found' });
    return;
  }

  // TODO: Initialize openid-client and build authorization URL
  // This requires the BSIM team to implement wallet:enroll scope

  // For now, return a placeholder that indicates the flow is not yet available
  res.status(503).json({
    error: 'not_available',
    message: 'Bank enrollment is not yet available. Waiting for BSIM integration.',
    bsimId: provider.bsimId,
    // When ready, this will return:
    // authUrl: 'https://auth.bsim.../authorize?...'
  });
});

/**
 * GET /api/enrollment/callback/:bsimId
 * Handle OIDC callback from bank
 *
 * NOTE: Placeholder - full implementation pending BSIM integration
 */
router.get('/callback/:bsimId', async (req, res) => {
  const { bsimId } = req.params;
  const { code, state, error } = req.query;

  if (error) {
    res.redirect(`${env.FRONTEND_URL}/enroll?error=${error}`);
    return;
  }

  // TODO: Implement full OIDC callback handling
  // 1. Validate state against session
  // 2. Exchange code for tokens
  // 3. Extract wallet_credential from token claims
  // 4. Create/update user profile
  // 5. Fetch cards from BSIM
  // 6. Store enrollment and cards

  res.redirect(`${env.FRONTEND_URL}/enroll?error=not_implemented`);
});

/**
 * DELETE /api/enrollment/:enrollmentId
 * Remove a bank enrollment and all associated cards
 */
router.delete('/:enrollmentId', requireAuth, async (req, res) => {
  // TODO: Implement enrollment removal
  // 1. Verify enrollment belongs to user
  // 2. Revoke credential at BSIM (if supported)
  // 3. Soft-delete all cards from this enrollment
  // 4. Delete enrollment record

  res.status(501).json({
    error: 'not_implemented',
    message: 'Enrollment removal not yet implemented',
  });
});

export default router;

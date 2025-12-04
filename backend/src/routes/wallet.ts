import { Router } from 'express';
import { prisma } from '../config/database';
import { requireAuth } from '../middleware/auth';

const router = Router();

// All wallet routes require authentication
router.use(requireAuth);

/**
 * GET /api/wallet/cards
 * List all cards in the user's wallet
 */
router.get('/cards', async (req, res) => {
  try {
    const cards = await prisma.walletCard.findMany({
      where: {
        userId: req.userId,
        isActive: true,
      },
      include: {
        enrollment: {
          select: {
            bsimId: true,
          },
        },
      },
      orderBy: [
        { isDefault: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    res.json({
      cards: cards.map((card: typeof cards[number]) => ({
        id: card.id,
        cardType: card.cardType,
        lastFour: card.lastFour,
        cardholderName: card.cardholderName,
        expiryMonth: card.expiryMonth,
        expiryYear: card.expiryYear,
        bsimId: card.enrollment.bsimId,
        isDefault: card.isDefault,
        walletCardToken: card.walletCardToken,
      })),
    });
  } catch (error) {
    console.error('[Wallet] Error fetching cards:', error);
    res.status(500).json({ error: 'internal_error', message: 'Failed to fetch cards' });
  }
});

/**
 * GET /api/wallet/cards/:cardId
 * Get a specific card
 */
router.get('/cards/:cardId', async (req, res) => {
  try {
    const card = await prisma.walletCard.findFirst({
      where: {
        id: req.params.cardId,
        userId: req.userId,
      },
      include: {
        enrollment: {
          select: {
            bsimId: true,
            bsimIssuer: true,
          },
        },
      },
    });

    if (!card) {
      res.status(404).json({ error: 'not_found', message: 'Card not found' });
      return;
    }

    res.json({
      id: card.id,
      cardType: card.cardType,
      lastFour: card.lastFour,
      cardholderName: card.cardholderName,
      expiryMonth: card.expiryMonth,
      expiryYear: card.expiryYear,
      bsimId: card.enrollment.bsimId,
      isDefault: card.isDefault,
      isActive: card.isActive,
      walletCardToken: card.walletCardToken,
    });
  } catch (error) {
    console.error('[Wallet] Error fetching card:', error);
    res.status(500).json({ error: 'internal_error', message: 'Failed to fetch card' });
  }
});

/**
 * POST /api/wallet/cards/:cardId/default
 * Set a card as the default
 */
router.post('/cards/:cardId/default', async (req, res) => {
  try {
    const card = await prisma.walletCard.findFirst({
      where: {
        id: req.params.cardId,
        userId: req.userId,
        isActive: true,
      },
    });

    if (!card) {
      res.status(404).json({ error: 'not_found', message: 'Card not found' });
      return;
    }

    // Clear existing default and set new one
    await prisma.$transaction([
      prisma.walletCard.updateMany({
        where: { userId: req.userId },
        data: { isDefault: false },
      }),
      prisma.walletCard.update({
        where: { id: card.id },
        data: { isDefault: true },
      }),
    ]);

    res.json({ success: true, cardId: card.id });
  } catch (error) {
    console.error('[Wallet] Error setting default card:', error);
    res.status(500).json({ error: 'internal_error', message: 'Failed to set default card' });
  }
});

/**
 * DELETE /api/wallet/cards/:cardId
 * Remove a card from the wallet (soft delete)
 */
router.delete('/cards/:cardId', async (req, res) => {
  try {
    const card = await prisma.walletCard.findFirst({
      where: {
        id: req.params.cardId,
        userId: req.userId,
      },
    });

    if (!card) {
      res.status(404).json({ error: 'not_found', message: 'Card not found' });
      return;
    }

    await prisma.walletCard.update({
      where: { id: card.id },
      data: { isActive: false },
    });

    res.json({ success: true, cardId: card.id });
  } catch (error) {
    console.error('[Wallet] Error removing card:', error);
    res.status(500).json({ error: 'internal_error', message: 'Failed to remove card' });
  }
});

/**
 * GET /api/wallet/enrollments
 * List all bank enrollments
 */
router.get('/enrollments', async (req, res) => {
  try {
    const enrollments = await prisma.bsimEnrollment.findMany({
      where: { userId: req.userId },
      select: {
        id: true,
        bsimId: true,
        createdAt: true,
        _count: {
          select: { cards: { where: { isActive: true } } },
        },
      },
    });

    res.json({
      enrollments: enrollments.map((e: typeof enrollments[number]) => ({
        id: e.id,
        bsimId: e.bsimId,
        cardCount: e._count.cards,
        enrolledAt: e.createdAt,
      })),
    });
  } catch (error) {
    console.error('[Wallet] Error fetching enrollments:', error);
    res.status(500).json({ error: 'internal_error', message: 'Failed to fetch enrollments' });
  }
});

/**
 * GET /api/wallet/profile
 * Get the user's wallet profile
 */
router.get('/profile', async (req, res) => {
  try {
    const user = await prisma.walletUser.findUnique({
      where: { id: req.userId },
      include: {
        _count: {
          select: {
            walletCards: { where: { isActive: true } },
            enrollments: true,
          },
        },
      },
    });

    if (!user) {
      res.status(404).json({ error: 'not_found', message: 'User not found' });
      return;
    }

    res.json({
      id: user.id,
      walletId: user.walletId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      cardCount: user._count.walletCards,
      enrollmentCount: user._count.enrollments,
      createdAt: user.createdAt,
    });
  } catch (error) {
    console.error('[Wallet] Error fetching profile:', error);
    res.status(500).json({ error: 'internal_error', message: 'Failed to fetch profile' });
  }
});

export default router;

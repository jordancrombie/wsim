// Mock PrismaClient for WSIM backend testing
// Based on BSIM patterns, adapted for Vitest and WSIM models

import { vi } from 'vitest';

// =============================================================================
// Mock Data Interfaces
// =============================================================================

export interface MockWalletUserData {
  id: string;
  email: string;
  passwordHash: string | null;
  firstName: string | null;
  lastName: string | null;
  walletId: string;
  createdAt: Date;
  updatedAt: Date;
  passkeyCredentials?: MockPasskeyCredentialData[];
  enrollments?: MockBsimEnrollmentData[];
  walletCards?: MockWalletCardData[];
}

export interface MockPasskeyCredentialData {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
  deviceName: string | null;
  aaguid: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  user?: MockWalletUserData;
}

export interface MockBsimEnrollmentData {
  id: string;
  userId: string;
  bsimId: string;
  bsimIssuer: string;
  fiUserRef: string;
  walletCredential: string;
  credentialExpiry: Date | null;
  refreshToken: string | null;
  createdAt: Date;
  updatedAt: Date;
  user?: MockWalletUserData;
  cards?: MockWalletCardData[];
}

export interface MockWalletCardData {
  id: string;
  userId: string;
  enrollmentId: string;
  cardType: string;
  lastFour: string;
  cardholderName: string;
  expiryMonth: number;
  expiryYear: number;
  bsimCardRef: string;
  walletCardToken: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  user?: MockWalletUserData;
  enrollment?: MockBsimEnrollmentData;
}

export interface MockPaymentContextData {
  id: string;
  grantId: string;
  walletCardId: string;
  walletCardToken: string;
  bsimCardToken: string | null;
  merchantId: string | null;
  merchantName: string | null;
  amount: { toString: () => string } | null;
  currency: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface MockOAuthClientData {
  id: string;
  clientId: string;
  clientSecret: string;
  clientName: string;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  grantTypes: string[];
  scope: string;
  logoUri: string | null;
  trusted: boolean;
  apiKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockMobileDeviceData {
  id: string;
  userId: string;
  deviceId: string;
  platform: 'ios' | 'android';
  deviceName: string;
  pushToken: string | null;
  deviceCredential: string;
  credentialExpiry: Date;
  biometricEnabled: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockMobileRefreshTokenData {
  id: string;
  token: string;
  userId: string;
  deviceId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface MockMobilePaymentRequestData {
  id: string;
  merchantId: string;
  merchantName: string;
  merchantLogoUrl: string | null;
  orderId: string;
  orderDescription: string | null;
  orderDetails: Record<string, unknown> | null;
  amount: { toString: () => string } | number;
  currency: string;
  returnUrl: string;
  status: 'pending' | 'approved' | 'completed' | 'cancelled' | 'expired';
  userId: string | null;
  selectedCardId: string | null;
  cardToken: string | null;
  walletCardToken: string | null;
  oneTimeToken: string | null;
  approvedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// =============================================================================
// Mock Factory
// =============================================================================

export function createMockPrismaClient() {
  // In-memory storage
  const walletUsers: MockWalletUserData[] = [];
  const passkeyCredentials: MockPasskeyCredentialData[] = [];
  const bsimEnrollments: MockBsimEnrollmentData[] = [];
  const walletCards: MockWalletCardData[] = [];
  const paymentContexts: MockPaymentContextData[] = [];
  const oAuthClients: MockOAuthClientData[] = [];
  const mobileDevices: MockMobileDeviceData[] = [];
  const mobileRefreshTokens: MockMobileRefreshTokenData[] = [];
  const mobilePaymentRequests: MockMobilePaymentRequestData[] = [];

  const mockPrisma = {
    // =========================================================================
    // WalletUser
    // =========================================================================
    walletUser: {
      findUnique: vi.fn().mockImplementation(async (args: any) => {
        const { where, include, select } = args;
        let user = walletUsers.find((u) => {
          if (where.id && u.id !== where.id) return false;
          if (where.email && u.email !== where.email) return false;
          if (where.walletId && u.walletId !== where.walletId) return false;
          return true;
        });

        if (!user) return null;

        // Clone to avoid mutation
        let result: any = { ...user };

        // Handle includes
        if (include?.passkeyCredentials) {
          result.passkeyCredentials = passkeyCredentials.filter(
            (p) => p.userId === user!.id
          );
        }
        if (include?.enrollments) {
          result.enrollments = bsimEnrollments.filter(
            (e) => e.userId === user!.id
          );
        }
        if (include?.walletCards) {
          result.walletCards = walletCards.filter((c) => c.userId === user!.id);
        }

        // Handle select
        if (select) {
          const selected: any = {};
          Object.keys(select).forEach((key) => {
            if (select[key]) selected[key] = result[key];
          });
          return selected;
        }

        return result;
      }),

      findFirst: vi.fn().mockImplementation(async (args: any) => {
        const { where } = args;
        return walletUsers.find((u) => {
          if (where?.email && u.email !== where.email) return false;
          return true;
        }) || null;
      }),

      create: vi.fn().mockImplementation(async (args: any) => {
        const { data } = args;
        // Check for duplicate email
        if (walletUsers.some((u) => u.email === data.email)) {
          const error: any = new Error('Unique constraint failed');
          error.code = 'P2002';
          throw error;
        }
        const newUser: MockWalletUserData = {
          id: data.id || `user-${Date.now()}`,
          email: data.email,
          passwordHash: data.passwordHash || null,
          firstName: data.firstName || null,
          lastName: data.lastName || null,
          walletId: data.walletId || `wallet-${Date.now()}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        walletUsers.push(newUser);
        return newUser;
      }),

      update: vi.fn().mockImplementation(async (args: any) => {
        const { where, data } = args;
        const index = walletUsers.findIndex((u) => u.id === where.id);
        if (index < 0) throw new Error('Not found');
        walletUsers[index] = { ...walletUsers[index], ...data, updatedAt: new Date() };
        return walletUsers[index];
      }),

      delete: vi.fn().mockImplementation(async (args: any) => {
        const { where } = args;
        const index = walletUsers.findIndex((u) => u.id === where.id);
        if (index < 0) throw new Error('Not found');
        const deleted = walletUsers.splice(index, 1)[0];
        return deleted;
      }),
    },

    // =========================================================================
    // PasskeyCredential
    // =========================================================================
    passkeyCredential: {
      findUnique: vi.fn().mockImplementation(async (args: any) => {
        const { where, include } = args;
        let passkey = passkeyCredentials.find((p) => {
          if (where.id && p.id !== where.id) return false;
          if (where.credentialId && p.credentialId !== where.credentialId) return false;
          return true;
        });

        if (!passkey) return null;

        // Clone to avoid mutation
        let result: any = { ...passkey };

        // Handle include for user
        if (include?.user) {
          const user = walletUsers.find((u) => u.id === passkey!.userId);
          result.user = user || null;
        }

        return result;
      }),

      findFirst: vi.fn().mockImplementation(async (args: any) => {
        const { where } = args;
        return passkeyCredentials.find((p) => {
          if (where?.id && p.id !== where.id) return false;
          if (where?.userId && p.userId !== where.userId) return false;
          if (where?.credentialId && p.credentialId !== where.credentialId) return false;
          return true;
        }) || null;
      }),

      findMany: vi.fn().mockImplementation(async (args?: any) => {
        let result = [...passkeyCredentials];

        // Filter by where clause
        if (args?.where) {
          result = result.filter((p) => {
            if (args.where.userId && p.userId !== args.where.userId) return false;
            return true;
          });
        }

        // Sort
        if (args?.orderBy?.createdAt === 'desc') {
          result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }

        // Handle select
        if (args?.select) {
          return result.map((p) => {
            const selected: any = {};
            Object.keys(args.select).forEach((key) => {
              if (args.select[key]) selected[key] = (p as any)[key];
            });
            return selected;
          });
        }

        return result;
      }),

      create: vi.fn().mockImplementation(async (args: any) => {
        const { data } = args;
        // Check for duplicate credentialId
        if (passkeyCredentials.some((p) => p.credentialId === data.credentialId)) {
          const error: any = new Error('Unique constraint failed');
          error.code = 'P2002';
          throw error;
        }
        const newPasskey: MockPasskeyCredentialData = {
          id: data.id || `passkey-${Date.now()}`,
          userId: data.userId,
          credentialId: data.credentialId,
          publicKey: data.publicKey,
          counter: data.counter || 0,
          transports: data.transports || [],
          deviceName: data.deviceName || null,
          aaguid: data.aaguid || null,
          createdAt: new Date(),
          lastUsedAt: null,
        };
        passkeyCredentials.push(newPasskey);
        return newPasskey;
      }),

      update: vi.fn().mockImplementation(async (args: any) => {
        const { where, data } = args;
        const index = passkeyCredentials.findIndex((p) => p.id === where.id);
        if (index < 0) throw new Error('Not found');
        passkeyCredentials[index] = { ...passkeyCredentials[index], ...data };
        return passkeyCredentials[index];
      }),

      delete: vi.fn().mockImplementation(async (args: any) => {
        const { where } = args;
        const index = passkeyCredentials.findIndex((p) => p.id === where.id);
        if (index < 0) throw new Error('Not found');
        const deleted = passkeyCredentials.splice(index, 1)[0];
        return deleted;
      }),

      deleteMany: vi.fn().mockImplementation(async (args: any) => {
        const { where } = args;
        const initialCount = passkeyCredentials.length;
        const toDelete = passkeyCredentials.filter((p) => {
          if (where.userId && p.userId !== where.userId) return false;
          if (where.id && p.id !== where.id) return false;
          return true;
        });
        toDelete.forEach((p) => {
          const idx = passkeyCredentials.indexOf(p);
          if (idx >= 0) passkeyCredentials.splice(idx, 1);
        });
        return { count: initialCount - passkeyCredentials.length };
      }),
    },

    // =========================================================================
    // BsimEnrollment
    // =========================================================================
    bsimEnrollment: {
      findUnique: vi.fn().mockImplementation(async (args: any) => {
        const { where, include } = args;
        let enrollment = bsimEnrollments.find((e) => {
          if (where.id && e.id !== where.id) return false;
          // Handle composite unique key
          if (where.userId_bsimId) {
            if (e.userId !== where.userId_bsimId.userId) return false;
            if (e.bsimId !== where.userId_bsimId.bsimId) return false;
          }
          return true;
        });

        if (!enrollment) return null;

        let result: any = { ...enrollment };

        if (include?.user) {
          result.user = walletUsers.find((u) => u.id === enrollment!.userId) || null;
        }
        if (include?.cards) {
          result.cards = walletCards.filter((c) => c.enrollmentId === enrollment!.id);
        }

        return result;
      }),

      findFirst: vi.fn().mockImplementation(async (args: any) => {
        const { where, include } = args;
        let enrollment = bsimEnrollments.find((e) => {
          if (where?.userId && e.userId !== where.userId) return false;
          if (where?.bsimId && e.bsimId !== where.bsimId) return false;
          return true;
        });

        if (!enrollment) return null;

        let result: any = { ...enrollment };

        if (include?.cards) {
          result.cards = walletCards.filter((c) => c.enrollmentId === enrollment!.id);
        }

        return result;
      }),

      findMany: vi.fn().mockImplementation(async (args?: any) => {
        let result = [...bsimEnrollments];

        if (args?.where) {
          result = result.filter((e) => {
            if (args.where.userId && e.userId !== args.where.userId) return false;
            return true;
          });
        }

        if (args?.include?.cards) {
          result = result.map((e) => ({
            ...e,
            cards: walletCards.filter((c) => c.enrollmentId === e.id),
          }));
        }

        return result;
      }),

      create: vi.fn().mockImplementation(async (args: any) => {
        const { data } = args;
        const newEnrollment: MockBsimEnrollmentData = {
          id: data.id || `enrollment-${Date.now()}`,
          userId: data.userId,
          bsimId: data.bsimId,
          bsimIssuer: data.bsimIssuer,
          fiUserRef: data.fiUserRef,
          walletCredential: data.walletCredential,
          credentialExpiry: data.credentialExpiry || null,
          refreshToken: data.refreshToken || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        bsimEnrollments.push(newEnrollment);
        return newEnrollment;
      }),

      update: vi.fn().mockImplementation(async (args: any) => {
        const { where, data } = args;
        const index = bsimEnrollments.findIndex((e) => e.id === where.id);
        if (index < 0) throw new Error('Not found');
        bsimEnrollments[index] = { ...bsimEnrollments[index], ...data, updatedAt: new Date() };
        return bsimEnrollments[index];
      }),

      upsert: vi.fn().mockImplementation(async (args: any) => {
        const { where, update, create } = args;
        let existingIndex = -1;

        if (where.userId_bsimId) {
          existingIndex = bsimEnrollments.findIndex(
            (e) => e.userId === where.userId_bsimId.userId && e.bsimId === where.userId_bsimId.bsimId
          );
        } else if (where.id) {
          existingIndex = bsimEnrollments.findIndex((e) => e.id === where.id);
        }

        if (existingIndex >= 0) {
          bsimEnrollments[existingIndex] = { ...bsimEnrollments[existingIndex], ...update, updatedAt: new Date() };
          return bsimEnrollments[existingIndex];
        } else {
          const newEnrollment: MockBsimEnrollmentData = {
            id: create.id || `enrollment-${Date.now()}`,
            ...create,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          bsimEnrollments.push(newEnrollment);
          return newEnrollment;
        }
      }),

      delete: vi.fn().mockImplementation(async (args: any) => {
        const { where } = args;
        let index = -1;
        if (where.userId_bsimId) {
          index = bsimEnrollments.findIndex(
            (e) => e.userId === where.userId_bsimId.userId && e.bsimId === where.userId_bsimId.bsimId
          );
        } else if (where.id) {
          index = bsimEnrollments.findIndex((e) => e.id === where.id);
        }
        if (index < 0) throw new Error('Not found');
        // Cascade delete cards
        const enrollmentId = bsimEnrollments[index].id;
        const cardIndicesToDelete = walletCards
          .map((c, i) => (c.enrollmentId === enrollmentId ? i : -1))
          .filter((i) => i >= 0)
          .reverse();
        cardIndicesToDelete.forEach((i) => walletCards.splice(i, 1));

        const deleted = bsimEnrollments.splice(index, 1)[0];
        return deleted;
      }),
    },

    // =========================================================================
    // WalletCard
    // =========================================================================
    walletCard: {
      findUnique: vi.fn().mockImplementation(async (args: any) => {
        const { where, include } = args;
        let card = walletCards.find((c) => {
          if (where.id && c.id !== where.id) return false;
          if (where.walletCardToken && c.walletCardToken !== where.walletCardToken) return false;
          return true;
        });

        if (!card) return null;

        let result: any = { ...card };

        if (include?.user) {
          result.user = walletUsers.find((u) => u.id === card!.userId) || null;
        }
        if (include?.enrollment) {
          result.enrollment = bsimEnrollments.find((e) => e.id === card!.enrollmentId) || null;
        }

        return result;
      }),

      findFirst: vi.fn().mockImplementation(async (args: any) => {
        const { where, include } = args;
        let card = walletCards.find((c) => {
          if (where?.id && c.id !== where.id) return false;
          if (where?.userId && c.userId !== where.userId) return false;
          if (where?.walletCardToken && c.walletCardToken !== where.walletCardToken) return false;
          if (where?.isActive !== undefined && c.isActive !== where.isActive) return false;
          return true;
        });

        if (!card) return null;

        let result: any = { ...card };

        if (include?.enrollment) {
          result.enrollment = bsimEnrollments.find((e) => e.id === card!.enrollmentId) || null;
        }

        return result;
      }),

      findMany: vi.fn().mockImplementation(async (args?: any) => {
        let result = [...walletCards];

        if (args?.where) {
          result = result.filter((c) => {
            if (args.where.userId && c.userId !== args.where.userId) return false;
            if (args.where.enrollmentId && c.enrollmentId !== args.where.enrollmentId) return false;
            if (args.where.isActive !== undefined && c.isActive !== args.where.isActive) return false;
            return true;
          });
        }

        if (args?.orderBy?.createdAt === 'desc') {
          result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }

        if (args?.include?.enrollment) {
          result = result.map((c) => ({
            ...c,
            enrollment: bsimEnrollments.find((e) => e.id === c.enrollmentId),
          }));
        }

        return result;
      }),

      create: vi.fn().mockImplementation(async (args: any) => {
        const { data } = args;
        const newCard: MockWalletCardData = {
          id: data.id || `card-${Date.now()}`,
          userId: data.userId,
          enrollmentId: data.enrollmentId,
          cardType: data.cardType,
          lastFour: data.lastFour,
          cardholderName: data.cardholderName,
          expiryMonth: data.expiryMonth,
          expiryYear: data.expiryYear,
          bsimCardRef: data.bsimCardRef,
          walletCardToken: data.walletCardToken,
          isDefault: data.isDefault ?? false,
          isActive: data.isActive ?? true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        walletCards.push(newCard);
        return newCard;
      }),

      update: vi.fn().mockImplementation(async (args: any) => {
        const { where, data } = args;
        const index = walletCards.findIndex((c) => c.id === where.id);
        if (index < 0) throw new Error('Not found');
        walletCards[index] = { ...walletCards[index], ...data, updatedAt: new Date() };
        return walletCards[index];
      }),

      updateMany: vi.fn().mockImplementation(async (args: any) => {
        const { where, data } = args;
        let count = 0;
        walletCards.forEach((card, index) => {
          let matches = true;
          if (where.userId && card.userId !== where.userId) matches = false;
          if (where.id && !where.id.not && card.id !== where.id) matches = false;
          if (where.id?.not && card.id === where.id.not) matches = false;
          if (matches) {
            walletCards[index] = { ...card, ...data, updatedAt: new Date() };
            count++;
          }
        });
        return { count };
      }),

      delete: vi.fn().mockImplementation(async (args: any) => {
        const { where } = args;
        const index = walletCards.findIndex((c) => c.id === where.id);
        if (index < 0) throw new Error('Not found');
        const deleted = walletCards.splice(index, 1)[0];
        return deleted;
      }),

      upsert: vi.fn().mockImplementation(async (args: any) => {
        const { where, update, create } = args;
        let existingIndex = -1;

        if (where.enrollmentId_bsimCardRef) {
          existingIndex = walletCards.findIndex(
            (c) => c.enrollmentId === where.enrollmentId_bsimCardRef.enrollmentId &&
                   c.bsimCardRef === where.enrollmentId_bsimCardRef.bsimCardRef
          );
        } else if (where.walletCardToken) {
          existingIndex = walletCards.findIndex((c) => c.walletCardToken === where.walletCardToken);
        } else if (where.id) {
          existingIndex = walletCards.findIndex((c) => c.id === where.id);
        }

        if (existingIndex >= 0) {
          walletCards[existingIndex] = { ...walletCards[existingIndex], ...update, updatedAt: new Date() };
          return walletCards[existingIndex];
        } else {
          const newCard: MockWalletCardData = {
            id: create.id || `card-${Date.now()}`,
            ...create,
            isDefault: create.isDefault ?? false,
            isActive: create.isActive ?? true,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          walletCards.push(newCard);
          return newCard;
        }
      }),
    },

    // =========================================================================
    // PaymentContext
    // =========================================================================
    paymentContext: {
      findUnique: vi.fn().mockImplementation(async (args: any) => {
        const { where } = args;
        return paymentContexts.find((p) => {
          if (where.id && p.id !== where.id) return false;
          if (where.grantId && p.grantId !== where.grantId) return false;
          return true;
        }) || null;
      }),

      create: vi.fn().mockImplementation(async (args: any) => {
        const { data } = args;
        const newContext: MockPaymentContextData = {
          id: data.id || `context-${Date.now()}`,
          grantId: data.grantId,
          walletCardId: data.walletCardId,
          walletCardToken: data.walletCardToken,
          bsimCardToken: data.bsimCardToken || null,
          merchantId: data.merchantId || null,
          merchantName: data.merchantName || null,
          amount: data.amount || null,
          currency: data.currency || null,
          createdAt: new Date(),
          expiresAt: data.expiresAt,
        };
        paymentContexts.push(newContext);
        return newContext;
      }),

      update: vi.fn().mockImplementation(async (args: any) => {
        const { where, data } = args;
        const index = paymentContexts.findIndex((p) => p.grantId === where.grantId);
        if (index < 0) throw new Error('Not found');
        paymentContexts[index] = { ...paymentContexts[index], ...data };
        return paymentContexts[index];
      }),

      upsert: vi.fn().mockImplementation(async (args: any) => {
        const { where, update, create } = args;
        const existingIndex = paymentContexts.findIndex((p) => p.grantId === where.grantId);

        if (existingIndex >= 0) {
          paymentContexts[existingIndex] = { ...paymentContexts[existingIndex], ...update };
          return paymentContexts[existingIndex];
        } else {
          const newContext: MockPaymentContextData = {
            id: create.id || `context-${Date.now()}`,
            grantId: create.grantId,
            walletCardId: create.walletCardId,
            walletCardToken: create.walletCardToken,
            bsimCardToken: create.bsimCardToken || null,
            merchantId: create.merchantId || null,
            merchantName: create.merchantName || null,
            amount: create.amount || null,
            currency: create.currency || null,
            createdAt: new Date(),
            expiresAt: create.expiresAt,
          };
          paymentContexts.push(newContext);
          return newContext;
        }
      }),

      delete: vi.fn().mockImplementation(async (args: any) => {
        const { where } = args;
        const index = paymentContexts.findIndex((p) => p.grantId === where.grantId);
        if (index < 0) throw new Error('Not found');
        const deleted = paymentContexts.splice(index, 1)[0];
        return deleted;
      }),

      deleteMany: vi.fn().mockImplementation(async (args: any) => {
        const { where } = args;
        const initialCount = paymentContexts.length;
        const now = new Date();
        const toDelete = paymentContexts.filter((p) => {
          if (where?.expiresAt?.lt && p.expiresAt >= where.expiresAt.lt) return false;
          return true;
        });
        toDelete.forEach((p) => {
          const idx = paymentContexts.indexOf(p);
          if (idx >= 0) paymentContexts.splice(idx, 1);
        });
        return { count: initialCount - paymentContexts.length };
      }),
    },

    // =========================================================================
    // OAuthClient
    // =========================================================================
    oAuthClient: {
      findFirst: vi.fn().mockImplementation(async (args: any) => {
        const { where } = args;
        return oAuthClients.find((c) => {
          if (where?.id && c.id !== where.id) return false;
          if (where?.clientId && c.clientId !== where.clientId) return false;
          if (where?.apiKey && c.apiKey !== where.apiKey) return false;
          return true;
        }) || null;
      }),

      findUnique: vi.fn().mockImplementation(async (args: any) => {
        const { where } = args;
        return oAuthClients.find((c) => {
          if (where?.id && c.id !== where.id) return false;
          if (where?.clientId && c.clientId !== where.clientId) return false;
          if (where?.apiKey && c.apiKey !== where.apiKey) return false;
          return true;
        }) || null;
      }),

      create: vi.fn().mockImplementation(async (args: any) => {
        const { data } = args;
        const newClient: MockOAuthClientData = {
          id: data.id || `client-${Date.now()}`,
          clientId: data.clientId,
          clientSecret: data.clientSecret,
          clientName: data.clientName,
          redirectUris: data.redirectUris || [],
          postLogoutRedirectUris: data.postLogoutRedirectUris || [],
          grantTypes: data.grantTypes || [],
          scope: data.scope || '',
          logoUri: data.logoUri || null,
          trusted: data.trusted ?? false,
          apiKey: data.apiKey || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        oAuthClients.push(newClient);
        return newClient;
      }),
    },

    // =========================================================================
    // MobileDevice
    // =========================================================================
    mobileDevice: {
      findUnique: vi.fn().mockImplementation(async (args: any) => {
        const { where } = args;
        return mobileDevices.find((d) => {
          if (where.id && d.id !== where.id) return false;
          if (where.deviceId && d.deviceId !== where.deviceId) return false;
          return true;
        }) || null;
      }),

      findFirst: vi.fn().mockImplementation(async (args: any) => {
        const { where } = args;
        return mobileDevices.find((d) => {
          if (where?.userId && d.userId !== where.userId) return false;
          if (where?.deviceId && d.deviceId !== where.deviceId) return false;
          return true;
        }) || null;
      }),

      create: vi.fn().mockImplementation(async (args: any) => {
        const { data } = args;
        const newDevice: MockMobileDeviceData = {
          id: data.id || `device-${Date.now()}`,
          userId: data.userId,
          deviceId: data.deviceId,
          platform: data.platform,
          deviceName: data.deviceName,
          pushToken: data.pushToken || null,
          deviceCredential: data.deviceCredential,
          credentialExpiry: data.credentialExpiry,
          biometricEnabled: data.biometricEnabled ?? false,
          lastUsedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        mobileDevices.push(newDevice);
        return newDevice;
      }),

      update: vi.fn().mockImplementation(async (args: any) => {
        const { where, data } = args;
        const index = mobileDevices.findIndex((d) => d.deviceId === where.deviceId);
        if (index < 0) throw new Error('Not found');
        mobileDevices[index] = { ...mobileDevices[index], ...data, updatedAt: new Date() };
        return mobileDevices[index];
      }),

      upsert: vi.fn().mockImplementation(async (args: any) => {
        const { where, update, create } = args;
        const existingIndex = mobileDevices.findIndex((d) => d.deviceId === where.deviceId);

        if (existingIndex >= 0) {
          mobileDevices[existingIndex] = { ...mobileDevices[existingIndex], ...update, updatedAt: new Date() };
          return mobileDevices[existingIndex];
        } else {
          const newDevice: MockMobileDeviceData = {
            id: create.id || `device-${Date.now()}`,
            ...create,
            biometricEnabled: create.biometricEnabled ?? false,
            lastUsedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          mobileDevices.push(newDevice);
          return newDevice;
        }
      }),
    },

    // =========================================================================
    // MobileRefreshToken
    // =========================================================================
    mobileRefreshToken: {
      findFirst: vi.fn().mockImplementation(async (args: any) => {
        const { where } = args;
        return mobileRefreshTokens.find((t) => {
          if (where?.token && t.token !== where.token) return false;
          if (where?.userId && t.userId !== where.userId) return false;
          if (where?.deviceId && t.deviceId !== where.deviceId) return false;
          if (where?.revokedAt === null && t.revokedAt !== null) return false;
          if (where?.expiresAt?.gt && t.expiresAt <= where.expiresAt.gt) return false;
          return true;
        }) || null;
      }),

      create: vi.fn().mockImplementation(async (args: any) => {
        const { data } = args;
        const newToken: MockMobileRefreshTokenData = {
          id: data.id || `token-${Date.now()}`,
          token: data.token,
          userId: data.userId,
          deviceId: data.deviceId,
          expiresAt: data.expiresAt,
          revokedAt: null,
          createdAt: new Date(),
        };
        mobileRefreshTokens.push(newToken);
        return newToken;
      }),

      update: vi.fn().mockImplementation(async (args: any) => {
        const { where, data } = args;
        const index = mobileRefreshTokens.findIndex((t) => t.id === where.id);
        if (index < 0) throw new Error('Not found');
        mobileRefreshTokens[index] = { ...mobileRefreshTokens[index], ...data };
        return mobileRefreshTokens[index];
      }),

      updateMany: vi.fn().mockImplementation(async (args: any) => {
        const { where, data } = args;
        let count = 0;
        mobileRefreshTokens.forEach((token, index) => {
          let matches = true;
          if (where.userId && token.userId !== where.userId) matches = false;
          if (where.deviceId && token.deviceId !== where.deviceId) matches = false;
          if (matches) {
            mobileRefreshTokens[index] = { ...token, ...data };
            count++;
          }
        });
        return { count };
      }),
    },

    // =========================================================================
    // MobilePaymentRequest
    // =========================================================================
    mobilePaymentRequest: {
      findUnique: vi.fn().mockImplementation(async (args: any) => {
        const { where } = args;
        return mobilePaymentRequests.find((p) => {
          if (where.id && p.id !== where.id) return false;
          return true;
        }) || null;
      }),

      findMany: vi.fn().mockImplementation(async (args?: any) => {
        let result = [...mobilePaymentRequests];

        if (args?.where) {
          result = result.filter((p) => {
            if (args.where.userId && p.userId !== args.where.userId) return false;
            if (args.where.status && p.status !== args.where.status) return false;
            if (args.where.merchantId && p.merchantId !== args.where.merchantId) return false;
            if (args.where.orderId && p.orderId !== args.where.orderId) return false;
            if (args.where.expiresAt?.gt && p.expiresAt <= args.where.expiresAt.gt) return false;
            return true;
          });
        }

        if (args?.orderBy?.createdAt === 'desc') {
          result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }

        if (args?.take) {
          result = result.slice(0, args.take);
        }

        return result;
      }),

      create: vi.fn().mockImplementation(async (args: any) => {
        const { data } = args;
        const newRequest: MockMobilePaymentRequestData = {
          id: data.id || `payment-${Date.now()}`,
          merchantId: data.merchantId,
          merchantName: data.merchantName,
          merchantLogoUrl: data.merchantLogoUrl || null,
          orderId: data.orderId,
          orderDescription: data.orderDescription || null,
          orderDetails: data.orderDetails || null,
          amount: data.amount,
          currency: data.currency || 'CAD',
          returnUrl: data.returnUrl,
          status: data.status || 'pending',
          userId: data.userId || null,
          selectedCardId: null,
          cardToken: null,
          walletCardToken: null,
          oneTimeToken: null,
          approvedAt: null,
          completedAt: null,
          cancelledAt: null,
          expiresAt: data.expiresAt,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        mobilePaymentRequests.push(newRequest);
        return newRequest;
      }),

      update: vi.fn().mockImplementation(async (args: any) => {
        const { where, data } = args;
        const index = mobilePaymentRequests.findIndex((p) => p.id === where.id);
        if (index < 0) throw new Error('Not found');
        mobilePaymentRequests[index] = { ...mobilePaymentRequests[index], ...data, updatedAt: new Date() };
        return mobilePaymentRequests[index];
      }),

      updateMany: vi.fn().mockImplementation(async (args: any) => {
        const { where, data } = args;
        let count = 0;
        mobilePaymentRequests.forEach((request, index) => {
          let matches = true;
          if (where.merchantId && request.merchantId !== where.merchantId) matches = false;
          if (where.orderId && request.orderId !== where.orderId) matches = false;
          if (where.status && request.status !== where.status) matches = false;
          if (matches) {
            mobilePaymentRequests[index] = { ...request, ...data, updatedAt: new Date() };
            count++;
          }
        });
        return { count };
      }),
    },

    // =========================================================================
    // Helper methods for test setup
    // =========================================================================
    _addWalletUser: (user: MockWalletUserData) => {
      walletUsers.push(user);
    },
    _addPasskeyCredential: (passkey: MockPasskeyCredentialData) => {
      passkeyCredentials.push(passkey);
    },
    _addBsimEnrollment: (enrollment: MockBsimEnrollmentData) => {
      bsimEnrollments.push(enrollment);
    },
    _addWalletCard: (card: MockWalletCardData) => {
      walletCards.push(card);
    },
    _addPaymentContext: (context: MockPaymentContextData) => {
      paymentContexts.push(context);
    },
    _addOAuthClient: (client: MockOAuthClientData) => {
      oAuthClients.push(client);
    },
    _addMobileDevice: (device: MockMobileDeviceData) => {
      mobileDevices.push(device);
    },
    _addMobileRefreshToken: (token: MockMobileRefreshTokenData) => {
      mobileRefreshTokens.push(token);
    },
    _addMobilePaymentRequest: (request: MockMobilePaymentRequestData) => {
      mobilePaymentRequests.push(request);
    },
    _clear: () => {
      walletUsers.length = 0;
      passkeyCredentials.length = 0;
      bsimEnrollments.length = 0;
      walletCards.length = 0;
      paymentContexts.length = 0;
      oAuthClients.length = 0;
      mobileDevices.length = 0;
      mobileRefreshTokens.length = 0;
      mobilePaymentRequests.length = 0;
    },
    _getWalletUsers: () => walletUsers,
    _getPasskeyCredentials: () => passkeyCredentials,
    _getBsimEnrollments: () => bsimEnrollments,
    _getWalletCards: () => walletCards,
    _getPaymentContexts: () => paymentContexts,
    _getOAuthClients: () => oAuthClients,
    _getMobileDevices: () => mobileDevices,
    _getMobileRefreshTokens: () => mobileRefreshTokens,
    _getMobilePaymentRequests: () => mobilePaymentRequests,
  };

  return mockPrisma;
}

export type MockPrismaClient = ReturnType<typeof createMockPrismaClient>;

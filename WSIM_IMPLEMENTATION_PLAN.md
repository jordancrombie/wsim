# WSIM Implementation Plan

> **AI Context**: This is the core wallet simulator implementation plan. WSIM is a new project that will be built from scratch. It should follow the patterns established in bsim, ssim, and nsim (located at `/Users/jcrombie/ai/`). The recommended tech stack is Express.js + TypeScript for backend, Next.js 14 for frontend, PostgreSQL with Prisma for database, and oidc-provider for the authorization server.

## Project Overview

WSIM (Wallet Simulator) is a centralized digital wallet that:
1. Aggregates payment credentials from multiple bsims
2. Provides a unified authentication layer for users
3. Issues payment tokens to merchants (ssims) via OIDC
4. Acts as an intermediary between ssim and bsim for card selection

## Project Structure

```
wsim/
├── backend/                      # Express.js API server
│   ├── src/
│   │   ├── index.ts              # App entry point
│   │   ├── app.ts                # Express app setup
│   │   ├── config/
│   │   │   ├── database.ts       # Prisma client
│   │   │   ├── env.ts            # Environment config
│   │   │   └── bsim-providers.ts # Configured bsim OIDC providers
│   │   ├── routes/
│   │   │   ├── index.ts          # Route aggregator
│   │   │   ├── auth.ts           # Authentication routes
│   │   │   ├── enrollment.ts     # Bank enrollment flow
│   │   │   ├── wallet.ts         # Wallet/card management
│   │   │   └── payment.ts        # Payment authorization
│   │   ├── services/
│   │   │   ├── user.ts           # User/profile service
│   │   │   ├── enrollment.ts     # Enrollment service
│   │   │   ├── card.ts           # Card management
│   │   │   ├── bsim-client.ts    # BSIM API client
│   │   │   └── token.ts          # Token generation
│   │   ├── middleware/
│   │   │   ├── auth.ts           # Session/JWT validation
│   │   │   └── error.ts          # Error handling
│   │   └── utils/
│   │       ├── crypto.ts         # Encryption utilities
│   │       └── validators.ts     # Input validation
│   └── prisma/
│       ├── schema.prisma         # Database schema
│       └── migrations/
├── auth-server/                  # OIDC Provider for ssims
│   ├── src/
│   │   ├── index.ts
│   │   ├── oidc-config.ts        # oidc-provider configuration
│   │   ├── adapters/
│   │   │   └── prisma.ts         # Prisma adapter for oidc-provider
│   │   ├── routes/
│   │   │   ├── interaction.ts    # Login/consent interactions
│   │   │   └── authorize.ts      # Card selection during payment
│   │   └── views/
│   │       ├── login.ejs         # Login page
│   │       ├── consent.ejs       # Consent page
│   │       └── card-select.ejs   # Card selection for payment
│   └── package.json
├── frontend/                     # Next.js 14 UI
│   ├── src/
│   │   └── app/
│   │       ├── layout.tsx
│   │       ├── page.tsx          # Landing page
│   │       ├── enroll/
│   │       │   ├── page.tsx      # Bank selection
│   │       │   └── callback/
│   │       │       └── [bsimId]/
│   │       │           └── page.tsx  # Enrollment callback
│   │       ├── wallet/
│   │       │   ├── page.tsx      # Card list/management
│   │       │   └── cards/
│   │       │       └── [cardId]/
│   │       │           └── page.tsx  # Card details
│   │       ├── profile/
│   │       │   └── page.tsx      # User profile
│   │       └── api/
│   │           └── [...path]/
│   │               └── route.ts  # API proxy (optional)
│   ├── components/
│   │   ├── CardList.tsx
│   │   ├── CardItem.tsx
│   │   ├── BankSelector.tsx
│   │   └── PaymentConsent.tsx
│   └── package.json
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## Implementation Tasks

### Phase 1: Project Setup (Days 1-2)

#### Task 1.1: Initialize Project

```bash
# Create project structure
mkdir -p wsim/{backend,auth-server,frontend}

# Backend setup
cd wsim/backend
npm init -y
npm install express typescript ts-node @types/node @types/express
npm install prisma @prisma/client
npm install dotenv cors helmet
npm install openid-client  # For bsim OIDC client
npm install jsonwebtoken @types/jsonwebtoken
npm install express-session @types/express-session
npm install bcrypt @types/bcrypt
npx tsc --init
npx prisma init

# Auth server setup
cd ../auth-server
npm init -y
npm install oidc-provider express ejs
npm install typescript ts-node @types/node @types/express
npx tsc --init

# Frontend setup
cd ../frontend
npx create-next-app@latest . --typescript --tailwind --app
```

#### Task 1.2: Database Schema

Create Prisma schema (see data models in ARCHITECTURE_PLAN.md):

```prisma
// backend/prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model WalletUser {
  id              String   @id @default(uuid())
  email           String   @unique
  firstName       String?
  lastName        String?
  walletId        String   @unique @default(uuid())
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  enrollments     BsimEnrollment[]
  walletCards     WalletCard[]
  paymentConsents WalletPaymentConsent[]
}

model BsimEnrollment {
  id               String   @id @default(uuid())
  userId           String
  user             WalletUser @relation(fields: [userId], references: [id])

  bsimId           String
  bsimIssuer       String
  fiUserRef        String

  walletCredential String   // Encrypted
  credentialExpiry DateTime?
  refreshToken     String?  // Encrypted

  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  cards            WalletCard[]

  @@unique([userId, bsimId])
  @@index([userId])
}

model WalletCard {
  id              String   @id @default(uuid())
  userId          String
  user            WalletUser @relation(fields: [userId], references: [id])
  enrollmentId    String
  enrollment      BsimEnrollment @relation(fields: [enrollmentId], references: [id])

  cardType        String
  lastFour        String
  cardholderName  String
  expiryMonth     Int
  expiryYear      Int
  bsimCardRef     String

  walletCardToken String   @unique

  isDefault       Boolean  @default(false)
  isActive        Boolean  @default(true)

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([enrollmentId, bsimCardRef])
  @@index([userId])
  @@index([walletCardToken])
}

model WalletPaymentConsent {
  id              String   @id @default(uuid())
  userId          String
  user            WalletUser @relation(fields: [userId], references: [id])

  merchantId      String
  merchantName    String
  walletCardId    String

  scope           String
  maxAmount       Decimal? @db.Decimal(15, 2)
  consentToken    String   @unique

  expiresAt       DateTime
  revokedAt       DateTime?
  createdAt       DateTime @default(now())

  @@index([userId])
  @@index([consentToken])
}

// OIDC Provider storage (for auth-server)
model OidcPayload {
  id         String   @id
  type       String
  payload    String   @db.Text
  grantId    String?
  userCode   String?
  uid        String?
  expiresAt  DateTime?
  consumedAt DateTime?

  @@index([grantId])
  @@index([userCode])
  @@index([uid])
}

model OAuthClient {
  id                     String   @id @default(uuid())
  clientId               String   @unique
  clientSecret           String
  clientName             String
  redirectUris           String[]
  postLogoutRedirectUris String[]
  grantTypes             String[]
  scope                  String
  logoUri                String?

  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt
}
```

#### Task 1.3: Environment Configuration

```bash
# backend/.env
DATABASE_URL="postgresql://postgres:password@localhost:5432/wsim"
JWT_SECRET="your-jwt-secret"
SESSION_SECRET="your-session-secret"
ENCRYPTION_KEY="32-byte-encryption-key-here"

# BSIM providers (JSON array)
BSIM_PROVIDERS='[{"bsimId":"td-bank","issuer":"https://auth.td.banksim.ca","clientId":"wsim-client","clientSecret":"secret"}]'

# Server config
PORT=3003
FRONTEND_URL="http://localhost:3004"
AUTH_SERVER_URL="http://localhost:3005"

# auth-server/.env
DATABASE_URL="postgresql://postgres:password@localhost:5432/wsim"
ISSUER="http://localhost:3005"
PORT=3005
BACKEND_URL="http://localhost:3003"

# frontend/.env.local
NEXT_PUBLIC_API_URL="http://localhost:3003"
NEXT_PUBLIC_AUTH_URL="http://localhost:3005"
```

### Acceptance Criteria - Phase 1
- [ ] All three projects initialize without errors
- [ ] Prisma migrations run successfully
- [ ] Basic Express server starts on backend
- [ ] Next.js dev server starts on frontend
- [ ] oidc-provider starts on auth-server

---

### Phase 2: BSIM OIDC Client (Days 3-4)

#### Task 2.1: BSIM Provider Configuration

```typescript
// backend/src/config/bsim-providers.ts
import { Issuer, Client } from 'openid-client';

export interface BsimProviderConfig {
  bsimId: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const providers: Map<string, { config: BsimProviderConfig; client?: Client }> = new Map();

export async function initializeBsimProviders(): Promise<void> {
  const configs: BsimProviderConfig[] = JSON.parse(process.env.BSIM_PROVIDERS || '[]');

  for (const config of configs) {
    try {
      const issuer = await Issuer.discover(config.issuer);
      const client = new issuer.Client({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uris: [config.redirectUri || `${process.env.APP_URL}/auth/callback/${config.bsimId}`],
        response_types: ['code'],
      });

      providers.set(config.bsimId, { config, client });
      console.log(`[BSIM] Initialized provider: ${config.bsimId}`);
    } catch (error) {
      console.error(`[BSIM] Failed to initialize ${config.bsimId}:`, error);
    }
  }
}

export function getBsimClient(bsimId: string): Client | undefined {
  return providers.get(bsimId)?.client;
}

export function getAvailableBsims(): BsimProviderConfig[] {
  return Array.from(providers.values()).map(p => p.config);
}
```

#### Task 2.2: Enrollment Routes

```typescript
// backend/src/routes/enrollment.ts
import { Router } from 'express';
import { generators } from 'openid-client';
import { getBsimClient, getAvailableBsims } from '../config/bsim-providers';

const router = Router();

// List available banks for enrollment
router.get('/banks', (req, res) => {
  const banks = getAvailableBsims().map(b => ({
    bsimId: b.bsimId,
    name: b.bsimId, // Could add display names to config
  }));
  res.json({ banks });
});

// Initiate enrollment with a bank
router.post('/start/:bsimId', async (req, res) => {
  const { bsimId } = req.params;
  const client = getBsimClient(bsimId);

  if (!client) {
    return res.status(404).json({ error: 'Bank not found' });
  }

  // Generate PKCE
  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);
  const state = generators.state();
  const nonce = generators.nonce();

  // Store in session
  req.session.enrollmentState = {
    bsimId,
    state,
    nonce,
    codeVerifier,
  };

  // Build authorization URL
  const authUrl = client.authorizationUrl({
    scope: 'openid profile email wallet:enroll',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  res.json({ authUrl });
});

// Handle callback from bank
router.get('/callback/:bsimId', async (req, res) => {
  const { bsimId } = req.params;
  const { code, state, error } = req.query;
  const { enrollmentState } = req.session;

  // Validate state
  if (!enrollmentState || state !== enrollmentState.state) {
    return res.redirect(`${process.env.FRONTEND_URL}/enroll?error=invalid_state`);
  }

  if (error) {
    return res.redirect(`${process.env.FRONTEND_URL}/enroll?error=${error}`);
  }

  const client = getBsimClient(bsimId);
  if (!client) {
    return res.redirect(`${process.env.FRONTEND_URL}/enroll?error=provider_not_found`);
  }

  try {
    // Exchange code for tokens
    const tokenSet = await client.callback(
      `${process.env.APP_URL}/enrollment/callback/${bsimId}`,
      { code: code as string, state: state as string },
      {
        state: enrollmentState.state,
        nonce: enrollmentState.nonce,
        code_verifier: enrollmentState.codeVerifier,
      }
    );

    // Extract claims
    const claims = tokenSet.claims();
    const walletCredential = tokenSet.access_token; // Contains wallet:enroll scope

    // Create or update user
    const user = await createOrUpdateUser({
      email: claims.email as string,
      firstName: claims.given_name as string,
      lastName: claims.family_name as string,
    });

    // Create enrollment
    const enrollment = await createEnrollment({
      userId: user.id,
      bsimId,
      bsimIssuer: client.issuer.metadata.issuer!,
      fiUserRef: claims.sub!,
      walletCredential: encrypt(walletCredential!),
      refreshToken: tokenSet.refresh_token ? encrypt(tokenSet.refresh_token) : null,
    });

    // Fetch and store cards
    await fetchAndStoreCards(enrollment.id, walletCredential!);

    // Set session
    req.session.userId = user.id;
    delete req.session.enrollmentState;

    res.redirect(`${process.env.FRONTEND_URL}/wallet`);
  } catch (err) {
    console.error('[Enrollment] Error:', err);
    res.redirect(`${process.env.FRONTEND_URL}/enroll?error=enrollment_failed`);
  }
});

export default router;
```

#### Task 2.3: Card Fetching Service

```typescript
// backend/src/services/card.ts
import { prisma } from '../config/database';
import { decrypt } from '../utils/crypto';
import { generateWalletCardToken } from '../utils/tokens';

export async function fetchAndStoreCards(
  enrollmentId: string,
  walletCredential: string
): Promise<void> {
  const enrollment = await prisma.bsimEnrollment.findUnique({
    where: { id: enrollmentId },
  });

  if (!enrollment) {
    throw new Error('Enrollment not found');
  }

  // Call bsim's wallet/cards endpoint
  const response = await fetch(`${enrollment.bsimIssuer.replace('/auth', '')}/api/wallet/cards`, {
    headers: {
      Authorization: `Bearer ${walletCredential}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch cards: ${response.status}`);
  }

  const { cards } = await response.json();

  // Store each card
  for (const card of cards) {
    await prisma.walletCard.upsert({
      where: {
        enrollmentId_bsimCardRef: {
          enrollmentId,
          bsimCardRef: card.cardRef,
        },
      },
      create: {
        userId: enrollment.userId,
        enrollmentId,
        cardType: card.cardType,
        lastFour: card.lastFour,
        cardholderName: card.cardholderName,
        expiryMonth: card.expiryMonth,
        expiryYear: card.expiryYear,
        bsimCardRef: card.cardRef,
        walletCardToken: generateWalletCardToken(enrollment.bsimId),
      },
      update: {
        cardType: card.cardType,
        lastFour: card.lastFour,
        cardholderName: card.cardholderName,
        expiryMonth: card.expiryMonth,
        expiryYear: card.expiryYear,
      },
    });
  }
}

// Generate wallet card token with bsim routing info
export function generateWalletCardToken(bsimId: string): string {
  const uniqueId = crypto.randomUUID().replace(/-/g, '').substring(0, 12);
  return `wsim_${bsimId}_${uniqueId}`;
}
```

### Acceptance Criteria - Phase 2
- [ ] Can list available bsims for enrollment
- [ ] Can initiate OIDC flow to bsim
- [ ] Callback creates user and enrollment
- [ ] Cards are fetched and stored with wallet tokens
- [ ] Session is established after enrollment

---

### Phase 3: OIDC Provider for SSIMs (Days 5-6)

#### Task 3.1: OIDC Provider Setup

```typescript
// auth-server/src/oidc-config.ts
import Provider from 'oidc-provider';
import { PrismaAdapter } from './adapters/prisma';

const claims = {
  openid: ['sub'],
  profile: ['name', 'family_name', 'given_name'],
  email: ['email'],
  'payment:authorize': ['wallet_card_token', 'card_token', 'payment_amount'],
};

export function createOidcProvider(): Provider {
  const provider = new Provider(process.env.ISSUER!, {
    adapter: PrismaAdapter,

    clients: [], // Loaded from database

    claims,

    scopes: ['openid', 'profile', 'email', 'payment:authorize'],

    features: {
      devInteractions: { enabled: false },
      clientCredentials: { enabled: true },
      resourceIndicators: { enabled: true },
    },

    pkce: {
      required: () => true,
      methods: ['S256'],
    },

    ttl: {
      AccessToken: 300, // 5 minutes for payment tokens
      AuthorizationCode: 600,
      IdToken: 3600,
      RefreshToken: 86400 * 30,
    },

    interactions: {
      url(ctx, interaction) {
        return `/interaction/${interaction.uid}`;
      },
    },

    // Add card_token to access token claims
    extraTokenClaims: async (ctx, token) => {
      if (token.kind === 'AccessToken' && token.scope?.includes('payment:authorize')) {
        // Get payment context from session/grant
        const paymentContext = await getPaymentContext(token.grantId);

        if (paymentContext) {
          return {
            wallet_card_token: paymentContext.walletCardToken,
            card_token: paymentContext.cardToken,
            payment_amount: paymentContext.amount,
          };
        }
      }
      return {};
    },

    findAccount: async (ctx, sub) => {
      const user = await prisma.walletUser.findUnique({
        where: { id: sub },
      });

      if (!user) return undefined;

      return {
        accountId: user.id,
        async claims() {
          return {
            sub: user.id,
            name: `${user.firstName} ${user.lastName}`,
            given_name: user.firstName,
            family_name: user.lastName,
            email: user.email,
          };
        },
      };
    },
  });

  return provider;
}
```

#### Task 3.2: Payment Interaction Flow

```typescript
// auth-server/src/routes/interaction.ts
import { Router } from 'express';
import { Provider } from 'oidc-provider';
import { prisma } from '../config/database';
import { requestCardToken } from '../services/bsim-client';

export function createInteractionRoutes(provider: Provider): Router {
  const router = Router();

  // Get interaction details
  router.get('/:uid', async (req, res) => {
    const interaction = await provider.interactionDetails(req, res);

    const { prompt, params, session } = interaction;

    // If payment:authorize scope, show card selection
    if (params.scope?.includes('payment:authorize')) {
      // Parse payment claims
      const paymentClaims = params.claims ? JSON.parse(params.claims as string) : {};

      // Get user's cards
      const userId = session?.accountId;
      if (!userId) {
        // Need to login first
        return res.render('login', {
          uid: req.params.uid,
          returnTo: `/interaction/${req.params.uid}`,
        });
      }

      const cards = await prisma.walletCard.findMany({
        where: { userId, isActive: true },
        include: { enrollment: true },
      });

      return res.render('card-select', {
        uid: req.params.uid,
        cards,
        payment: paymentClaims.payment || {},
        client: params.client_id,
      });
    }

    // Regular login/consent flow
    if (prompt.name === 'login') {
      return res.render('login', { uid: req.params.uid });
    }

    if (prompt.name === 'consent') {
      return res.render('consent', {
        uid: req.params.uid,
        scopes: params.scope?.split(' '),
        client: params.client_id,
      });
    }
  });

  // Handle card selection for payment
  router.post('/:uid/select-card', async (req, res) => {
    const interaction = await provider.interactionDetails(req, res);
    const { walletCardId } = req.body;

    const card = await prisma.walletCard.findUnique({
      where: { id: walletCardId },
      include: { enrollment: true },
    });

    if (!card) {
      return res.status(400).json({ error: 'Card not found' });
    }

    // Request card token from bsim
    const paymentClaims = interaction.params.claims
      ? JSON.parse(interaction.params.claims as string)
      : {};

    const cardToken = await requestCardToken({
      enrollment: card.enrollment,
      cardRef: card.bsimCardRef,
      merchantId: paymentClaims.payment?.merchantId,
      amount: paymentClaims.payment?.amount,
    });

    // Store payment context for extraTokenClaims
    await storePaymentContext(interaction.grantId, {
      walletCardToken: card.walletCardToken,
      cardToken,
      amount: paymentClaims.payment?.amount,
    });

    // Complete interaction
    const result = {
      login: { accountId: interaction.session!.accountId },
      consent: {
        grantId: interaction.grantId,
      },
    };

    await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: true });
  });

  return router;
}
```

#### Task 3.3: Card Selection View

```html
<!-- auth-server/src/views/card-select.ejs -->
<!DOCTYPE html>
<html>
<head>
  <title>Select Payment Card - WalletSim</title>
  <style>
    /* Tailwind-like styles */
    .card-option {
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      padding: 16px;
      margin: 8px 0;
      cursor: pointer;
      transition: border-color 0.2s;
    }
    .card-option:hover {
      border-color: #6366f1;
    }
    .card-option.selected {
      border-color: #6366f1;
      background-color: #eef2ff;
    }
    .card-icon {
      font-size: 24px;
      margin-right: 12px;
    }
  </style>
</head>
<body class="bg-gray-100 min-h-screen flex items-center justify-center">
  <div class="bg-white p-8 rounded-lg shadow-md max-w-md w-full">
    <h1 class="text-2xl font-bold mb-4">Select Payment Card</h1>

    <div class="mb-6 p-4 bg-gray-50 rounded">
      <p class="text-sm text-gray-600">Payment to:</p>
      <p class="font-semibold"><%= payment.merchantName || client %></p>
      <p class="text-xl font-bold mt-2">$<%= payment.amount %> <%= payment.currency || 'CAD' %></p>
    </div>

    <form action="/interaction/<%= uid %>/select-card" method="POST">
      <% cards.forEach(card => { %>
        <label class="card-option block">
          <input type="radio" name="walletCardId" value="<%= card.id %>" required>
          <span class="card-icon">💳</span>
          <span class="font-semibold"><%= card.cardType %></span>
          <span>****<%= card.lastFour %></span>
          <span class="text-gray-500 text-sm ml-2">
            Expires <%= card.expiryMonth %>/<%= card.expiryYear %>
          </span>
          <br>
          <span class="text-xs text-gray-400 ml-8">
            via <%= card.enrollment.bsimId %>
          </span>
        </label>
      <% }) %>

      <div class="mt-6 flex justify-between">
        <button type="button" onclick="window.close()"
          class="px-4 py-2 border rounded text-gray-600">
          Cancel
        </button>
        <button type="submit"
          class="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700">
          Authorize Payment
        </button>
      </div>
    </form>
  </div>
</body>
</html>
```

### Acceptance Criteria - Phase 3
- [ ] OIDC provider starts and serves well-known config
- [ ] ssim can discover and register with wsim
- [ ] Payment flow shows card selection UI
- [ ] Card token is requested from correct bsim
- [ ] Access token includes walletCardToken and cardToken claims

---

### Phase 4: Frontend UI (Days 7-8)

#### Task 4.1: Wallet Dashboard

```typescript
// frontend/src/app/wallet/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { CardList } from '@/components/CardList';
import { AddBankButton } from '@/components/AddBankButton';

interface Card {
  id: string;
  cardType: string;
  lastFour: string;
  cardholderName: string;
  expiryMonth: number;
  expiryYear: number;
  bsimId: string;
  isDefault: boolean;
}

export default function WalletPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCards();
  }, []);

  async function fetchCards() {
    const res = await fetch('/api/wallet/cards', { credentials: 'include' });
    const data = await res.json();
    setCards(data.cards);
    setLoading(false);
  }

  async function setDefaultCard(cardId: string) {
    await fetch(`/api/wallet/cards/${cardId}/default`, {
      method: 'POST',
      credentials: 'include',
    });
    fetchCards();
  }

  async function removeCard(cardId: string) {
    if (!confirm('Remove this card from your wallet?')) return;

    await fetch(`/api/wallet/cards/${cardId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    fetchCards();
  }

  if (loading) {
    return <div className="p-8">Loading...</div>;
  }

  return (
    <div className="max-w-2xl mx-auto p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">My Wallet</h1>
        <AddBankButton />
      </div>

      {cards.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <p className="text-gray-500 mb-4">No cards in your wallet yet.</p>
          <AddBankButton variant="primary" />
        </div>
      ) : (
        <CardList
          cards={cards}
          onSetDefault={setDefaultCard}
          onRemove={removeCard}
        />
      )}
    </div>
  );
}
```

#### Task 4.2: Bank Enrollment UI

```typescript
// frontend/src/app/enroll/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

interface Bank {
  bsimId: string;
  name: string;
  logoUrl?: string;
}

export default function EnrollPage() {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  useEffect(() => {
    fetchBanks();
  }, []);

  async function fetchBanks() {
    const res = await fetch('/api/enrollment/banks');
    const data = await res.json();
    setBanks(data.banks);
    setLoading(false);
  }

  async function enrollWithBank(bsimId: string) {
    const res = await fetch(`/api/enrollment/start/${bsimId}`, {
      method: 'POST',
      credentials: 'include',
    });
    const { authUrl } = await res.json();
    window.location.href = authUrl;
  }

  return (
    <div className="max-w-md mx-auto p-8">
      <h1 className="text-2xl font-bold mb-6">Add a Bank</h1>

      {error && (
        <div className="bg-red-100 text-red-700 p-4 rounded mb-4">
          {error === 'invalid_state' && 'Session expired. Please try again.'}
          {error === 'enrollment_failed' && 'Failed to connect to bank. Please try again.'}
          {!['invalid_state', 'enrollment_failed'].includes(error) && error}
        </div>
      )}

      <p className="text-gray-600 mb-6">
        Connect your bank to add your cards to your digital wallet.
      </p>

      {loading ? (
        <div>Loading banks...</div>
      ) : (
        <div className="space-y-3">
          {banks.map(bank => (
            <button
              key={bank.bsimId}
              onClick={() => enrollWithBank(bank.bsimId)}
              className="w-full p-4 border rounded-lg hover:border-indigo-500 hover:bg-indigo-50 transition flex items-center"
            >
              <span className="text-2xl mr-3">🏦</span>
              <span className="font-semibold">{bank.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Acceptance Criteria - Phase 4
- [ ] Wallet dashboard shows enrolled cards
- [ ] Can set default card
- [ ] Can remove cards
- [ ] Bank enrollment page lists available bsims
- [ ] Clicking bank initiates enrollment flow

---

### Phase 5: Integration & Testing (Days 9-10)

#### Task 5.1: End-to-End Flow Testing

Test the complete flow:
1. User visits wsim → redirected to enrollment
2. User selects bsim → redirects to bsim auth
3. User authenticates at bsim → returns to wsim
4. Cards are fetched and displayed
5. User visits ssim checkout → clicks "Pay with Wallet"
6. Redirects to wsim card selection
7. User selects card → wsim requests token from bsim
8. Returns to ssim with tokens
9. ssim authorizes via nsim
10. Payment completes

#### Task 5.2: Error Handling

Implement error handling for:
- [ ] Expired wallet credentials (need re-enrollment)
- [ ] Failed bsim token requests
- [ ] Invalid/expired sessions
- [ ] Network failures

#### Task 5.3: Security Review

- [ ] All secrets encrypted at rest
- [ ] PKCE enforced on all OIDC flows
- [ ] Sessions use secure, httpOnly cookies
- [ ] CORS configured correctly
- [ ] Rate limiting on sensitive endpoints

---

## Docker Compose Setup

```yaml
# docker-compose.yml
version: '3.8'

services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
      POSTGRES_DB: wsim
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  backend:
    build: ./backend
    ports:
      - "3003:3003"
    environment:
      DATABASE_URL: postgresql://postgres:password@postgres:5432/wsim
      JWT_SECRET: ${JWT_SECRET}
      SESSION_SECRET: ${SESSION_SECRET}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      BSIM_PROVIDERS: ${BSIM_PROVIDERS}
    depends_on:
      - postgres

  auth-server:
    build: ./auth-server
    ports:
      - "3005:3005"
    environment:
      DATABASE_URL: postgresql://postgres:password@postgres:5432/wsim
      ISSUER: http://localhost:3005
      BACKEND_URL: http://backend:3003
    depends_on:
      - postgres

  frontend:
    build: ./frontend
    ports:
      - "3004:3000"
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:3003
      NEXT_PUBLIC_AUTH_URL: http://localhost:3005

volumes:
  postgres_data:
```

---

## Summary

| Phase | Duration | Key Deliverables |
|-------|----------|-----------------|
| 1. Setup | Days 1-2 | Project structure, database, basic servers |
| 2. BSIM Client | Days 3-4 | Enrollment flow, card fetching |
| 3. OIDC Provider | Days 5-6 | Payment authorization, card selection |
| 4. Frontend | Days 7-8 | Wallet UI, enrollment UI |
| 5. Integration | Days 9-10 | E2E testing, error handling |

**Total: ~10 days**

---

## Questions to Resolve

1. Should we support multiple cards per enrollment (current assumption: yes)?
2. What happens when a card is removed at bsim but still in wsim?
3. How long should wallet credentials be valid?
4. Should we support recurring payments (card-on-file)?

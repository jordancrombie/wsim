import Provider, { Configuration, KoaContextWithOIDC, Account, AccountClaims, AdapterPayload } from 'oidc-provider';
import { PrismaAdapter, prisma } from './adapters/prisma';
import { env } from './config/env';

// Define supported claims per scope
const claims: Configuration['claims'] = {
  openid: ['sub'],
  profile: ['name', 'family_name', 'given_name'],
  email: ['email', 'email_verified'],
  'payment:authorize': ['wallet_card_token', 'card_token', 'payment_amount', 'payment_currency'],
};

// Define supported scopes
const scopes = ['openid', 'profile', 'email', 'payment:authorize'];

/**
 * Create and configure the OIDC Provider
 */
export async function createOidcProvider(): Promise<Provider> {
  // Load OAuth clients from database
  const dbClients = await prisma.oAuthClient.findMany();

  const clients: Configuration['clients'] = dbClients.map(client => ({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    client_name: client.clientName,
    redirect_uris: client.redirectUris,
    post_logout_redirect_uris: client.postLogoutRedirectUris,
    grant_types: client.grantTypes as string[],
    scope: client.scope,
    logo_uri: client.logoUri || undefined,
  }));

  // Add a default dev client if none exist
  if (clients.length === 0 && env.NODE_ENV === 'development') {
    clients.push({
      client_id: 'dev-ssim',
      client_secret: 'dev-secret',
      client_name: 'Development SSIM',
      redirect_uris: ['http://localhost:3006/payment/wallet-callback'],
      post_logout_redirect_uris: ['http://localhost:3006'],
      grant_types: ['authorization_code', 'refresh_token'],
      scope: 'openid profile email payment:authorize',
    });
  }

  const configuration: Configuration = {
    // Use Prisma adapter for storage
    adapter: PrismaAdapter as unknown as Configuration['adapter'],

    // Registered clients
    clients,

    // Claims configuration
    claims,

    // Supported scopes
    scopes,

    // Features
    features: {
      devInteractions: { enabled: env.NODE_ENV === 'development' },
      clientCredentials: { enabled: false },
      resourceIndicators: { enabled: false },
      revocation: { enabled: true },
    },

    // PKCE configuration
    pkce: {
      required: () => true,
    },

    // Token TTLs
    ttl: {
      AccessToken: 300, // 5 minutes (short for payment tokens)
      AuthorizationCode: 600, // 10 minutes
      IdToken: 3600, // 1 hour
      RefreshToken: 86400 * 30, // 30 days
      Interaction: 3600, // 1 hour
      Session: 86400 * 14, // 14 days
      Grant: 86400 * 14, // 14 days
    },

    // Interaction URLs
    interactions: {
      url(_ctx: KoaContextWithOIDC, interaction: { uid: string }) {
        return `/interaction/${interaction.uid}`;
      },
    },

    // Cookies configuration
    cookies: {
      keys: [env.COOKIE_SECRET],
    },

    // Extra token claims (add wallet/card tokens for payment scope)
    extraTokenClaims: async (_ctx: KoaContextWithOIDC, token: { kind: string; scope?: string; grantId?: string }) => {
      // Only add payment claims for payment:authorize scope
      if (token.kind !== 'AccessToken' || !token.scope?.includes('payment:authorize')) {
        return {};
      }

      // Get payment context from grant
      // This will be populated during the card selection interaction
      const grantId = token.grantId;
      if (!grantId) return {};

      // Look up payment context (stored during card selection)
      // TODO: Implement payment context storage and retrieval
      // For now, return empty - will be implemented with card selection UI

      return {};
    },

    // Find account by ID
    findAccount: async (_ctx: KoaContextWithOIDC, sub: string): Promise<Account | undefined> => {
      const user = await prisma.walletUser.findUnique({
        where: { id: sub },
      });

      if (!user) return undefined;

      return {
        accountId: user.id,
        async claims(_use: string, scope: string): Promise<AccountClaims> {
          const claimsObj: AccountClaims = {
            sub: user.id,
          };

          if (scope?.includes('profile')) {
            claimsObj.name = [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined;
            claimsObj.given_name = user.firstName || undefined;
            claimsObj.family_name = user.lastName || undefined;
          }

          if (scope?.includes('email')) {
            claimsObj.email = user.email;
            claimsObj.email_verified = true; // Assume verified via bsim
          }

          return claimsObj;
        },
      };
    },

    // Render error pages
    renderError: async (ctx: KoaContextWithOIDC, out: { error: string; error_description?: string }, _error: Error) => {
      ctx.type = 'html';
      ctx.body = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Error - WSIM</title>
          <style>
            body { font-family: sans-serif; padding: 2rem; max-width: 600px; margin: 0 auto; }
            .error { background: #fee; padding: 1rem; border-radius: 8px; }
            code { background: #f0f0f0; padding: 0.2rem 0.4rem; border-radius: 4px; }
          </style>
        </head>
        <body>
          <h1>Authentication Error</h1>
          <div class="error">
            <p><strong>Error:</strong> ${out.error}</p>
            ${out.error_description ? `<p>${out.error_description}</p>` : ''}
          </div>
          <p><a href="/">Return to home</a></p>
        </body>
        </html>
      `;
    },
  };

  const provider = new Provider(env.ISSUER, configuration);

  // Allow HTTP in development
  if (env.NODE_ENV === 'development') {
    provider.proxy = true;
  }

  return provider;
}

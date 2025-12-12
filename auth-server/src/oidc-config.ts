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
      devInteractions: { enabled: false }, // Disabled - we use custom interaction routes
      clientCredentials: { enabled: false },
      revocation: { enabled: true },
      // Enable resource indicators to issue JWT access tokens
      resourceIndicators: {
        enabled: true,
        defaultResource: () => 'urn:wsim:payment-api',
        getResourceServerInfo: () => ({
          scope: 'openid profile email payment:authorize',
          accessTokenFormat: 'jwt',
          accessTokenTTL: 300, // 5 minutes
        }),
      },
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

    // For payment:authorize scope, always require fresh consent (new card selection)
    // This ensures each payment creates a new grant with fresh payment context
    loadExistingGrant: async (ctx) => {
      const requestedScopes = (ctx.oidc.params?.scope as string)?.split(' ') || [];

      // First, check if there's a grant from the current interaction result (just created)
      // This happens after card selection when we're about to issue tokens
      const resultGrantId = ctx.oidc.result?.consent?.grantId;
      if (resultGrantId) {
        console.log(`[OIDC] Using grant from interaction result: ${resultGrantId.substring(0, 8)}...`);
        return ctx.oidc.provider.Grant.find(resultGrantId);
      }

      // If payment:authorize is requested and there's no result grant, require fresh consent
      if (requestedScopes.includes('payment:authorize')) {
        console.log('[OIDC] Payment scope requested - requiring fresh consent');
        return undefined; // Return undefined to force new consent
      }

      // For non-payment flows, allow reusing existing session grants
      const sessionGrantId = ctx.oidc.session?.grantIdFor(ctx.oidc.client?.clientId as string);
      if (sessionGrantId) {
        return ctx.oidc.provider.Grant.find(sessionGrantId);
      }

      return undefined;
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
      console.log(`[OIDC] extraTokenClaims called: kind=${token.kind}, scope=${token.scope}, grantId=${token.grantId || 'none'}`);

      // Only add payment claims for payment:authorize scope
      if (token.kind !== 'AccessToken' || !token.scope?.includes('payment:authorize')) {
        console.log('[OIDC] Skipping - not an access token with payment:authorize scope');
        return {};
      }

      // Get payment context from grant
      const grantId = token.grantId;
      if (!grantId) {
        console.log('[OIDC] No grantId in token, cannot get payment context');
        return {};
      }

      // Look up payment context from backend
      const url = `${env.BACKEND_URL}/api/payment/context/${grantId}`;
      console.log(`[OIDC] Fetching payment context from: ${url}`);

      try {
        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${env.INTERNAL_API_SECRET}`,
          },
        });

        console.log(`[OIDC] Payment context response: ${response.status} ${response.statusText}`);

        if (!response.ok) {
          const errorText = await response.text();
          console.log(`[OIDC] Payment context not found for grant ${grantId}: ${errorText}`);
          return {};
        }

        const context = await response.json() as {
          walletCardToken: string;
          bsimCardToken: string | null;
          amount?: string;
          currency?: string;
        };

        console.log(`[OIDC] Got payment context:`, JSON.stringify(context));

        const claims = {
          wallet_card_token: context.walletCardToken,
          card_token: context.bsimCardToken || undefined,
          payment_amount: context.amount ? parseFloat(context.amount) : undefined,
          payment_currency: context.currency,
        };

        console.log(`[OIDC] Returning claims:`, JSON.stringify(claims));
        return claims;
      } catch (error) {
        console.error('[OIDC] Error fetching payment context:', error);
        return {};
      }
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

  // Enable proxy mode when behind a reverse proxy (nginx) that terminates SSL.
  // This makes oidc-provider trust X-Forwarded-Proto headers and generate
  // correct HTTPS URLs in the discovery document and redirects.
  // Required in both dev and production when running behind nginx.
  provider.proxy = true;

  return provider;
}

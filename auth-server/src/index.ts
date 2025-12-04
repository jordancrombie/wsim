import express from 'express';
import path from 'path';
import { env } from './config/env';
import { createOidcProvider } from './oidc-config';
import { createInteractionRoutes } from './routes/interaction';
import { prisma } from './adapters/prisma';

async function main() {
  const app = express();

  // View engine setup
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  // Body parsing
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  // Create OIDC provider
  const provider = await createOidcProvider();

  // Mount interaction routes (login, consent, card selection)
  app.use('/interaction', createInteractionRoutes(provider));

  // Health check
  app.get('/health', async (req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'wsim-auth-server',
      });
    } catch {
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        service: 'wsim-auth-server',
      });
    }
  });

  // Home page
  app.get('/', (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>WSIM Auth Server</title>
        <style>
          body { font-family: sans-serif; padding: 2rem; max-width: 600px; margin: 0 auto; }
          a { color: #667eea; }
        </style>
      </head>
      <body>
        <h1>WSIM Authorization Server</h1>
        <p>This is the OIDC provider for the Wallet Simulator.</p>
        <ul>
          <li><a href="/.well-known/openid-configuration">OpenID Configuration</a></li>
          <li><a href="/health">Health Check</a></li>
        </ul>
      </body>
      </html>
    `);
  });

  // Mount OIDC provider
  app.use(provider.callback());

  // Start server
  app.listen(env.PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   WSIM Auth Server (OIDC Provider)                         ║
║                                                            ║
║   Environment: ${env.NODE_ENV.padEnd(40)}║
║   Port:        ${String(env.PORT).padEnd(40)}║
║   Issuer:      ${env.ISSUER.padEnd(40)}║
║                                                            ║
║   OIDC Config: ${(env.ISSUER + '/.well-known/openid-configuration').padEnd(40).substring(0, 40)}║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
    `);
  });
}

// Handle shutdown
process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

main().catch((error) => {
  console.error('[Auth Server] Failed to start:', error);
  process.exit(1);
});

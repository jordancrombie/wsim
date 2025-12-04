import app from './app';
import { env, validateEnv } from './config/env';
import { prisma } from './config/database';

async function main() {
  // Validate environment
  validateEnv();

  // Test database connection
  try {
    await prisma.$connect();
    console.log('[Database] Connected successfully');
  } catch (error) {
    console.error('[Database] Connection failed:', error);
    process.exit(1);
  }

  // Start server
  app.listen(env.PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   WSIM Backend Server                                      ║
║                                                            ║
║   Environment: ${env.NODE_ENV.padEnd(40)}║
║   Port:        ${String(env.PORT).padEnd(40)}║
║   Frontend:    ${env.FRONTEND_URL.padEnd(40)}║
║   Auth Server: ${env.AUTH_SERVER_URL.padEnd(40)}║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
    `);
  });
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Server] SIGTERM received, shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Server] SIGINT received, shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});

main().catch((error) => {
  console.error('[Server] Failed to start:', error);
  process.exit(1);
});

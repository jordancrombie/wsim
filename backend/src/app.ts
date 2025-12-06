import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import { env } from './config/env';
import routes from './routes';
import { errorHandler, notFoundHandler } from './middleware/error';

const app = express();

// Security middleware
app.use(helmet());

// CORS - configured for cross-domain API access (e.g., SSIM merchant API calls)
// Note: origin must be explicit (not wildcard) when credentials: true
app.use(cors({
  origin: env.CORS_ORIGINS,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'x-api-key'],
}));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session management
// Note: For cross-domain API calls (e.g., SSIM calling WSIM merchant API),
// we need sameSite: 'none' with secure: true. This allows cookies to be sent
// in cross-origin requests when credentials: 'include' is used.
app.use(session({
  secret: env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: 'wsim.sid',
  cookie: {
    secure: true, // Required for sameSite: 'none'
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'none', // Allow cross-origin requests with credentials
  },
}));

// Trust proxy (for secure cookies behind reverse proxy - needed in both dev and prod)
// In dev we're behind nginx with SSL termination, so we need to trust the proxy
app.set('trust proxy', 1);

// Mount routes
app.use(routes);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;

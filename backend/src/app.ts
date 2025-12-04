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

// CORS
app.use(cors({
  origin: env.CORS_ORIGINS,
  credentials: true,
}));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session management
app.use(session({
  secret: env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: 'wsim.sid',
  cookie: {
    secure: env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax',
  },
}));

// Trust proxy in production (for secure cookies behind reverse proxy)
if (env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Mount routes
app.use(routes);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;

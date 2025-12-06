import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';

/**
 * Middleware to set security headers for iframe embedding.
 * Only allows embedding from approved origins.
 */
export function embedSecurityHeaders(req: Request, res: Response, next: NextFunction): void {
  const origin = req.query.origin as string;

  if (origin && env.ALLOWED_EMBED_ORIGINS.includes(origin)) {
    // Allow this specific origin to embed via CSP frame-ancestors
    // Note: X-Frame-Options is deprecated in favor of CSP, but we set both for compatibility
    res.setHeader('Content-Security-Policy', `frame-ancestors 'self' ${origin}`);

    // Permissions Policy to allow passkeys in cross-origin iframes
    // This is critical for WebAuthn to work inside the iframe
    res.setHeader('Permissions-Policy', 'publickey-credentials-get=(self), publickey-credentials-create=(self)');
  } else {
    // Block embedding from unknown/missing origins
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  }

  next();
}

/**
 * Validate that the origin is allowed for iframe embedding
 */
export function isAllowedEmbedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  return env.ALLOWED_EMBED_ORIGINS.includes(origin);
}

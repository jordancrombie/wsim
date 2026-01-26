/**
 * Device Authorization Web Flow
 *
 * Web-based device authorization flow for RFC 8628 Device Authorization Grant.
 * Users can visit /api/m/device to enter a device code and approve/reject the request.
 *
 * Supports optimized QR flow when Gateway appends signed token (&t=...) to URL:
 * - Automatically validates code, looks up user, sends push notification
 * - Shows fallback auth options (passkey/password) if push doesn't arrive
 *
 * Routes:
 * - GET /api/m/device - Device code entry page (pre-fills from ?code= param, handles &t= token)
 * - POST /api/m/device/lookup - Look up device code and show details
 * - GET /api/m/device/login - Login form (for unauthenticated users)
 * - POST /api/m/device/login/identify - Send login push notification
 * - GET /api/m/device/login/wait/:id - Poll for login approval
 * - POST /api/m/device/login/password - Authenticate with password (fallback)
 * - POST /api/m/device/login/passkey/options - Generate passkey auth options (fallback)
 * - POST /api/m/device/login/passkey/verify - Verify passkey auth response (fallback)
 * - GET /api/m/device/approve - Show approval screen (requires session auth)
 * - POST /api/m/device/approve - Approve the device code
 * - POST /api/m/device/reject - Reject the device code
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { Decimal } from '@prisma/client/runtime/library';
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  VerifiedAuthenticationResponse,
} from '@simplewebauthn/server';
import type { AuthenticatorTransportFuture, AuthenticationResponseJSON } from '@simplewebauthn/types';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { sendNotificationToUser } from '../services/notification';
import {
  generateAgentClientId,
  generateAgentClientSecret,
  hashClientSecret,
} from '../services/agent-auth';

// =============================================================================
// TOKEN VERIFICATION (for optimized QR code flow)
// =============================================================================

/**
 * Verify a device auth token from the Gateway.
 * Token format: base64url(email).hmac_sha256(email:code, INTERNAL_API_SECRET)
 *
 * @param token The token from the `t` query parameter
 * @param code The device code from the `code` query parameter
 * @returns The decoded email if valid, null if invalid
 */
function verifyDeviceAuthToken(token: string, code: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) {
      console.log('[Device Auth Token] Invalid token format: expected 2 parts');
      return null;
    }

    const [emailB64, signature] = parts;

    // Decode email from base64url
    const email = Buffer.from(emailB64, 'base64url').toString('utf-8');
    if (!email || !email.includes('@')) {
      console.log('[Device Auth Token] Invalid email in token');
      return null;
    }

    // Verify HMAC signature
    const expectedSignature = crypto
      .createHmac('sha256', env.INTERNAL_API_SECRET)
      .update(`${email}:${code}`)
      .digest('base64url');

    // Constant-time comparison to prevent timing attacks
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      console.log('[Device Auth Token] Signature verification failed');
      return null;
    }

    return email;
  } catch (err) {
    console.error('[Device Auth Token] Verification error:', err);
    return null;
  }
}

// =============================================================================
// PASSKEY CHALLENGE STORE (for fallback auth)
// =============================================================================

const passkeyChallenge = new Map<string, { challenge: string; userId: string; expiresAt: number }>();

// Clean up expired challenges periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of passkeyChallenge.entries()) {
    if (value.expiresAt < now) {
      passkeyChallenge.delete(key);
    }
  }
}, 60000);

function storePasskeyChallenge(loginId: string, challenge: string, userId: string): void {
  passkeyChallenge.set(loginId, {
    challenge,
    userId,
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
  });
}

function getPasskeyChallenge(loginId: string): { challenge: string; userId: string } | null {
  const stored = passkeyChallenge.get(loginId);
  if (!stored || stored.expiresAt < Date.now()) {
    passkeyChallenge.delete(loginId);
    return null;
  }
  passkeyChallenge.delete(loginId);
  return { challenge: stored.challenge, userId: stored.userId };
}

const router = Router();

// Extend session type for device auth
declare module 'express-session' {
  interface SessionData {
    deviceAuthCode?: string;
    deviceAuthRequestId?: string;
    loginRequestId?: string;
    deviceAuthUserId?: string;  // Known user from token verification (for fallback auth)
  }
}

// =============================================================================
// HTML PAGE RENDERERS
// =============================================================================

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderDeviceCodeEntryPage(prefillCode?: string, error?: string, nonce?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Enter Device Code - WSIM</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 32px;
      max-width: 400px;
      width: 100%;
      box-shadow: 0 20px 40px rgba(0,0,0,0.2);
    }
    .logo { text-align: center; margin-bottom: 24px; }
    .logo svg { width: 64px; height: 64px; }
    h1 { font-size: 24px; text-align: center; margin-bottom: 8px; color: #1a1a2e; }
    .subtitle { text-align: center; color: #666; margin-bottom: 24px; }
    .form-group { margin-bottom: 16px; }
    label { display: block; font-size: 14px; color: #666; margin-bottom: 8px; }
    input[type="text"] {
      width: 100%;
      padding: 14px 16px;
      border: 2px solid #e0e0e0;
      border-radius: 12px;
      font-size: 18px;
      font-family: monospace;
      text-align: center;
      letter-spacing: 2px;
      text-transform: uppercase;
      transition: border-color 0.2s;
    }
    input[type="text"]:focus { outline: none; border-color: #667eea; }
    input[type="text"]::placeholder { letter-spacing: normal; text-transform: none; }
    button {
      width: 100%;
      padding: 14px;
      background: #667eea;
      color: white;
      border: none;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    button:hover { background: #5a6fd6; }
    button:disabled { background: #ccc; cursor: not-allowed; }
    .error { background: #fee; color: #c00; padding: 12px; border-radius: 8px; margin-bottom: 16px; text-align: center; }
    .hint { font-size: 12px; color: #999; text-align: center; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="64" height="64" rx="16" fill="#667eea"/>
        <path d="M20 32L28 40L44 24" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>

    <h1>Enter Device Code</h1>
    <p class="subtitle">Enter the code shown on your device to connect it to your wallet</p>

    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}

    <form method="POST" action="/api/m/device/lookup">
      <div class="form-group">
        <label for="code">Device Code</label>
        <input type="text" id="code" name="code" required placeholder="WSIM-XXXXXX" value="${escapeHtml(prefillCode || '')}" autocomplete="off" autocapitalize="characters">
      </div>
      <button type="submit">Continue</button>
    </form>

    <p class="hint">The code is displayed by the application requesting access to your wallet.</p>
  </div>
</body>
</html>`;
}

function renderLoginPage(agentName: string, requestId: string, error?: string, nonce?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign In - WSIM</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 32px;
      max-width: 400px;
      width: 100%;
      box-shadow: 0 20px 40px rgba(0,0,0,0.2);
    }
    .logo { text-align: center; margin-bottom: 24px; }
    .logo svg { width: 64px; height: 64px; }
    h1 { font-size: 24px; text-align: center; margin-bottom: 8px; color: #1a1a2e; }
    .subtitle { text-align: center; color: #666; margin-bottom: 24px; }
    .agent-name { font-weight: 600; color: #667eea; }
    .form-group { margin-bottom: 16px; }
    label { display: block; font-size: 14px; color: #666; margin-bottom: 8px; }
    input[type="email"] {
      width: 100%;
      padding: 14px 16px;
      border: 2px solid #e0e0e0;
      border-radius: 12px;
      font-size: 16px;
      transition: border-color 0.2s;
    }
    input[type="email"]:focus { outline: none; border-color: #667eea; }
    button {
      width: 100%;
      padding: 14px;
      background: #667eea;
      color: white;
      border: none;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    button:hover { background: #5a6fd6; }
    button:disabled { background: #ccc; cursor: not-allowed; }
    .error { background: #fee; color: #c00; padding: 12px; border-radius: 8px; margin-bottom: 16px; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="64" height="64" rx="16" fill="#667eea"/>
        <path d="M20 32L28 40L44 24" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>

    <h1>Sign In to WSIM</h1>
    <p class="subtitle">Sign in to authorize <span class="agent-name">${escapeHtml(agentName)}</span></p>

    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}

    <form method="POST" action="/api/m/device/login/identify">
      <input type="hidden" name="request_id" value="${escapeHtml(requestId)}">
      <div class="form-group">
        <label for="email">Email Address</label>
        <input type="email" id="email" name="email" required placeholder="you@example.com" autocomplete="email">
      </div>
      <button type="submit">Continue</button>
    </form>
  </div>
</body>
</html>`;
}

interface WaitingPageOptions {
  email?: string;
  hasPasskey?: boolean;
}

function renderWaitingPage(loginId: string, options?: WaitingPageOptions): string {
  const { email, hasPasskey } = options || {};
  const showFallback = !!email; // Only show fallback if we know the user

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="3;url=/api/m/device/login/wait/${loginId}">
  <title>Check Your Phone - WSIM</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 32px;
      max-width: 400px;
      width: 100%;
      box-shadow: 0 20px 40px rgba(0,0,0,0.2);
      text-align: center;
    }
    h1 { font-size: 24px; margin-bottom: 8px; color: #1a1a2e; }
    .subtitle { color: #666; margin-bottom: 24px; }
    .spinner {
      width: 48px; height: 48px;
      border: 4px solid #e0e0e0;
      border-top-color: #667eea;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 24px auto;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .divider {
      display: flex;
      align-items: center;
      margin: 24px 0;
      color: #999;
      font-size: 14px;
    }
    .divider::before, .divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: #e0e0e0;
    }
    .divider span { padding: 0 16px; }
    .fallback { text-align: left; }
    .fallback-title { font-size: 14px; color: #666; margin-bottom: 12px; text-align: center; }
    .auth-btn {
      width: 100%;
      padding: 14px;
      background: #f5f5f7;
      color: #333;
      border: 2px solid #e0e0e0;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .auth-btn:hover { background: #e8e8e8; border-color: #667eea; }
    .auth-btn svg { width: 20px; height: 20px; }
    .form-group { margin-bottom: 16px; text-align: left; }
    .form-group label { display: block; font-size: 14px; color: #666; margin-bottom: 8px; }
    .form-group input {
      width: 100%;
      padding: 12px 14px;
      border: 2px solid #e0e0e0;
      border-radius: 12px;
      font-size: 16px;
      transition: border-color 0.2s;
    }
    .form-group input:focus { outline: none; border-color: #667eea; }
    .submit-btn {
      width: 100%;
      padding: 14px;
      background: #667eea;
      color: white;
      border: none;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    .submit-btn:hover { background: #5a6fd6; }
    .error { background: #fee; color: #c00; padding: 12px; border-radius: 8px; margin-bottom: 16px; text-align: center; display: none; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Check Your Phone</h1>
    <p class="subtitle">Open the WSIM app to approve this sign-in</p>
    <div class="spinner" id="spinner"></div>
    <p class="subtitle" id="status-text">Waiting for approval...</p>

    ${showFallback ? `
    <div class="divider"><span>OR</span></div>

    <div class="fallback">
      <p class="fallback-title">Didn't get the notification? Sign in here:</p>

      ${hasPasskey ? `
      <button type="button" class="auth-btn" id="passkey-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        Sign in with Passkey
      </button>
      ` : ''}

      <button type="button" class="auth-btn" id="password-toggle">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
          <polyline points="22,6 12,13 2,6"/>
        </svg>
        Sign in with Password
      </button>

      <form id="password-form" class="hidden" method="POST" action="/api/m/device/login/password">
        <input type="hidden" name="login_id" value="${escapeHtml(loginId)}">
        <div id="password-error" class="error"></div>
        <div class="form-group">
          <label>Email</label>
          <input type="email" name="email" value="${escapeHtml(email || '')}" readonly style="background: #f5f5f7;">
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" name="password" required placeholder="Enter your password" autocomplete="current-password">
        </div>
        <button type="submit" class="submit-btn">Sign In</button>
      </form>
    </div>

    <script>
      // Toggle password form
      document.getElementById('password-toggle')?.addEventListener('click', function() {
        document.getElementById('password-form').classList.toggle('hidden');
        this.classList.add('hidden');
      });

      ${hasPasskey ? `
      // Passkey authentication
      document.getElementById('passkey-btn')?.addEventListener('click', async function() {
        try {
          this.disabled = true;
          this.textContent = 'Authenticating...';

          // Get authentication options
          const optionsRes = await fetch('/api/m/device/login/passkey/options', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ login_id: '${escapeHtml(loginId)}' })
          });
          const options = await optionsRes.json();
          if (!optionsRes.ok) throw new Error(options.error || 'Failed to get options');

          // Call WebAuthn API
          const credential = await navigator.credentials.get({
            publicKey: {
              challenge: Uint8Array.from(atob(options.challenge.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
              rpId: options.rpId,
              allowCredentials: options.allowCredentials?.map(c => ({
                id: Uint8Array.from(atob(c.id.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0)),
                type: c.type,
                transports: c.transports
              })),
              userVerification: options.userVerification || 'preferred',
              timeout: options.timeout || 60000
            }
          });

          // Encode response
          const response = {
            id: credential.id,
            rawId: btoa(String.fromCharCode(...new Uint8Array(credential.rawId))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=/g, ''),
            type: credential.type,
            response: {
              authenticatorData: btoa(String.fromCharCode(...new Uint8Array(credential.response.authenticatorData))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=/g, ''),
              clientDataJSON: btoa(String.fromCharCode(...new Uint8Array(credential.response.clientDataJSON))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=/g, ''),
              signature: btoa(String.fromCharCode(...new Uint8Array(credential.response.signature))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=/g, ''),
              userHandle: credential.response.userHandle ? btoa(String.fromCharCode(...new Uint8Array(credential.response.userHandle))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=/g, '') : null
            }
          };

          // Verify with server
          const verifyRes = await fetch('/api/m/device/login/passkey/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ login_id: '${escapeHtml(loginId)}', response })
          });
          const result = await verifyRes.json();

          if (verifyRes.ok && result.success) {
            window.location.href = '/api/m/device/approve';
          } else {
            throw new Error(result.error || 'Verification failed');
          }
        } catch (err) {
          console.error('Passkey auth failed:', err);
          this.disabled = false;
          this.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Sign in with Passkey';
          alert('Passkey authentication failed. Please try password instead.');
        }
      });
      ` : ''}
    </script>
    ` : ''}
  </div>
</body>
</html>`;
}

function renderApprovalPage(
  requestId: string,
  agentName: string,
  agentDescription: string | null,
  permissions: string[],
  limits: { perTransaction: string; daily: string; monthly: string; currency: string },
  expiresAt: Date,
  nonce?: string
): string {
  const permissionDescriptions: Record<string, string> = {
    browse: 'View products and prices',
    cart: 'Manage shopping cart',
    purchase: 'Make purchases on your behalf',
    history: 'View transaction history',
  };

  const timeRemaining = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  const minutes = Math.floor(timeRemaining / 60);
  const seconds = timeRemaining % 60;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize Access - WSIM</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 32px;
      max-width: 440px;
      width: 100%;
      box-shadow: 0 20px 40px rgba(0,0,0,0.2);
    }
    .logo { text-align: center; margin-bottom: 24px; }
    .logo svg { width: 64px; height: 64px; }
    h1 { font-size: 24px; text-align: center; margin-bottom: 8px; color: #1a1a2e; }
    .subtitle { text-align: center; color: #666; margin-bottom: 24px; }
    .agent-name { font-weight: 600; color: #667eea; }
    .section { background: #f5f5f7; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    .section h3 { font-size: 14px; color: #666; margin-bottom: 12px; }
    .permission { display: flex; align-items: center; padding: 8px 0; }
    .permission svg { width: 20px; height: 20px; margin-right: 12px; color: #667eea; flex-shrink: 0; }
    .permission span { color: #333; }
    .limit { display: flex; justify-content: space-between; padding: 6px 0; }
    .limit-label { color: #666; }
    .limit-value { font-weight: 600; color: #333; }
    .buttons { display: flex; gap: 12px; margin-top: 24px; }
    button {
      flex: 1;
      padding: 14px;
      border: none;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn-approve { background: #4CAF50; color: white; }
    .btn-approve:hover { background: #43a047; }
    .btn-reject { background: #f5f5f7; color: #666; }
    .btn-reject:hover { background: #e8e8e8; }
    .timer { text-align: center; font-size: 12px; color: #999; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="64" height="64" rx="16" fill="#667eea"/>
        <path d="M20 32L28 40L44 24" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>

    <h1>Authorize Access</h1>
    <p class="subtitle"><span class="agent-name">${escapeHtml(agentName)}</span> wants to connect to your wallet</p>
    ${agentDescription ? `<p class="subtitle" style="font-size: 14px; margin-top: -16px;">${escapeHtml(agentDescription)}</p>` : ''}

    <div class="section">
      <h3>Requested Permissions</h3>
      ${permissions.map(p => `
        <div class="permission">
          <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
          <span>${escapeHtml(permissionDescriptions[p] || p)}</span>
        </div>
      `).join('')}
    </div>

    <div class="section">
      <h3>Spending Limits</h3>
      <div class="limit">
        <span class="limit-label">Per Transaction</span>
        <span class="limit-value">${escapeHtml(limits.currency)} ${escapeHtml(limits.perTransaction)}</span>
      </div>
      <div class="limit">
        <span class="limit-label">Daily Limit</span>
        <span class="limit-value">${escapeHtml(limits.currency)} ${escapeHtml(limits.daily)}</span>
      </div>
      <div class="limit">
        <span class="limit-label">Monthly Limit</span>
        <span class="limit-value">${escapeHtml(limits.currency)} ${escapeHtml(limits.monthly)}</span>
      </div>
    </div>

    <div class="buttons">
      <form method="POST" action="/api/m/device/reject" style="flex: 1;">
        <input type="hidden" name="request_id" value="${escapeHtml(requestId)}">
        <button type="submit" class="btn-reject" style="width: 100%;">Reject</button>
      </form>
      <form method="POST" action="/api/m/device/approve" style="flex: 1;">
        <input type="hidden" name="request_id" value="${escapeHtml(requestId)}">
        <button type="submit" class="btn-approve" style="width: 100%;">Approve</button>
      </form>
    </div>

    <p class="timer">This request expires in ${minutes}:${seconds.toString().padStart(2, '0')}</p>
  </div>
</body>
</html>`;
}

function renderSuccessPage(action: 'approved' | 'rejected', agentName: string): string {
  const isApproved = action === 'approved';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${isApproved ? 'Access Granted' : 'Request Rejected'} - WSIM</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 32px;
      max-width: 400px;
      width: 100%;
      box-shadow: 0 20px 40px rgba(0,0,0,0.2);
      text-align: center;
    }
    .icon { margin-bottom: 24px; }
    .icon svg { width: 64px; height: 64px; }
    h1 { font-size: 24px; margin-bottom: 8px; color: #1a1a2e; }
    .subtitle { color: #666; margin-bottom: 24px; }
    .agent-name { font-weight: 600; color: #667eea; }
    .hint { font-size: 14px; color: #999; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">
      ${isApproved ? `
        <svg viewBox="0 0 64 64" fill="none">
          <circle cx="32" cy="32" r="32" fill="#4CAF50"/>
          <path d="M20 32L28 40L44 24" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      ` : `
        <svg viewBox="0 0 64 64" fill="none">
          <circle cx="32" cy="32" r="32" fill="#f44336"/>
          <path d="M24 24L40 40M40 24L24 40" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `}
    </div>

    <h1>${isApproved ? 'Access Granted' : 'Request Rejected'}</h1>
    <p class="subtitle">
      ${isApproved
        ? `<span class="agent-name">${escapeHtml(agentName)}</span> now has access to your wallet.`
        : `You've rejected access for <span class="agent-name">${escapeHtml(agentName)}</span>.`}
    </p>
    <p class="hint">You can close this window now.</p>
  </div>
</body>
</html>`;
}

function renderErrorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error - WSIM</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 32px;
      max-width: 400px;
      width: 100%;
      box-shadow: 0 20px 40px rgba(0,0,0,0.2);
      text-align: center;
    }
    .icon { margin-bottom: 24px; }
    .icon svg { width: 64px; height: 64px; }
    h1 { font-size: 24px; margin-bottom: 8px; color: #1a1a2e; }
    .subtitle { color: #666; margin-bottom: 24px; }
    a { color: #667eea; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">
      <svg viewBox="0 0 64 64" fill="none">
        <circle cx="32" cy="32" r="32" fill="#ff9800"/>
        <path d="M32 20V36" stroke="white" stroke-width="4" stroke-linecap="round"/>
        <circle cx="32" cy="44" r="2" fill="white"/>
      </svg>
    </div>

    <h1>Something went wrong</h1>
    <p class="subtitle">${escapeHtml(message)}</p>
    <a href="/api/m/device">Try again</a>
  </div>
</body>
</html>`;
}

// =============================================================================
// ROUTES
// =============================================================================

/**
 * GET /api/m/device
 * Device code entry page
 *
 * Supports optimized QR flow when both `code` and `t` (token) params are provided.
 * Token format: base64url(email).hmac_sha256(email:code, INTERNAL_API_SECRET)
 * When valid, skips manual code entry and email login - sends push directly.
 */
router.get('/', async (req: Request, res: Response) => {
  const code = req.query.code as string | undefined;
  const token = req.query.t as string | undefined;

  // If no token provided, show normal code entry page
  if (!token || !code) {
    return res.send(renderDeviceCodeEntryPage(code));
  }

  // Optimized flow: verify token and auto-authenticate
  try {
    // Normalize the code
    let normalizedCode = code.toUpperCase().trim();
    if (!normalizedCode.startsWith('WSIM-')) {
      normalizedCode = `WSIM-${normalizedCode}`;
    }

    // Verify the token
    const email = verifyDeviceAuthToken(token, normalizedCode);
    if (!email) {
      console.log('[Device Auth Web] Invalid token, falling back to code entry');
      return res.send(renderDeviceCodeEntryPage(code, 'Invalid link. Please enter the code manually.'));
    }

    console.log(`[Device Auth Web] Optimized flow: valid token for ${email}`);

    // Find user by email
    const user = await prisma.walletUser.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!user) {
      // User doesn't exist in WSIM - can't use optimized flow
      console.log(`[Device Auth Web] User not found for email ${email}, falling back`);
      return res.send(renderDeviceCodeEntryPage(code, 'Account not found. Please sign in with your WSIM email.'));
    }

    // Find and validate the pairing code
    const pairingCode = await prisma.pairingCode.findUnique({
      where: { code: normalizedCode },
      include: { accessRequest: true },
    });

    if (!pairingCode) {
      return res.send(renderDeviceCodeEntryPage(code, 'Invalid code. Please check and try again.'));
    }

    if (pairingCode.status !== 'active') {
      return res.send(renderDeviceCodeEntryPage(code, 'This code has already been used.'));
    }

    if (pairingCode.expiresAt < new Date()) {
      await prisma.pairingCode.update({
        where: { id: pairingCode.id },
        data: { status: 'expired' },
      });
      return res.send(renderDeviceCodeEntryPage(code, 'This code has expired.'));
    }

    const accessRequest = pairingCode.accessRequest;
    if (!accessRequest || (accessRequest.status !== 'pending_claim' && accessRequest.status !== 'pending')) {
      return res.send(renderDeviceCodeEntryPage(code, 'No pending authorization for this code.'));
    }

    // Pre-link the code to the user (claim it)
    if (accessRequest.status === 'pending_claim') {
      await prisma.$transaction(async (tx) => {
        await tx.pairingCode.update({
          where: { id: pairingCode.id },
          data: { userId: user.id },
        });
        await tx.accessRequest.update({
          where: { id: accessRequest.id },
          data: { status: 'pending' },
        });
      });
      console.log(`[Device Auth Web] Optimized flow: code ${normalizedCode} claimed by user ${user.id}`);
    }

    // Store in session for approval flow
    req.session.deviceAuthCode = normalizedCode;
    req.session.deviceAuthRequestId = accessRequest.id;
    req.session.deviceAuthUserId = user.id; // Store known user for fallback auth

    // Since we verified the token, we know this is the correct user.
    // Set the session to authenticate them and redirect directly to approval.
    // This avoids sending a redundant push notification (device_authorization
    // endpoint already sent one when Gateway passed buyer_email).
    (req.session as { userId?: string }).userId = user.id;

    console.log(`[Device Auth Web] Optimized flow: user ${user.id.substring(0, 8)}... authenticated via token, redirecting to approval`);

    // Redirect directly to approval page - no second push needed
    return res.redirect('/api/m/device/approve');
  } catch (error) {
    console.error('[Device Auth Web] Optimized flow error:', error);
    // Fall back to normal code entry on any error
    return res.send(renderDeviceCodeEntryPage(code, 'Something went wrong. Please try again.'));
  }
});

/**
 * POST /api/m/device/lookup
 * Look up the device code and show login or approval screen
 */
router.post('/lookup', async (req: Request, res: Response) => {
  try {
    let { code } = req.body;

    if (!code) {
      return res.send(renderDeviceCodeEntryPage(undefined, 'Please enter a device code'));
    }

    // Normalize the code
    code = code.toUpperCase().trim();
    if (!code.startsWith('WSIM-')) {
      code = `WSIM-${code}`;
    }

    // Find the pairing code
    const pairingCode = await prisma.pairingCode.findUnique({
      where: { code },
      include: { accessRequest: true },
    });

    if (!pairingCode) {
      return res.send(renderDeviceCodeEntryPage(code, 'Invalid code. Please check and try again.'));
    }

    // Check if this is a device authorization code (has null userId initially)
    if (pairingCode.userId !== null && pairingCode.accessRequest?.status !== 'pending') {
      return res.send(renderDeviceCodeEntryPage(code, 'This code is not a device authorization code'));
    }

    if (pairingCode.status !== 'active') {
      return res.send(renderDeviceCodeEntryPage(code, 'This code has already been used'));
    }

    if (pairingCode.expiresAt < new Date()) {
      await prisma.pairingCode.update({
        where: { id: pairingCode.id },
        data: { status: 'expired' },
      });
      return res.send(renderDeviceCodeEntryPage(code, 'This code has expired'));
    }

    const accessRequest = pairingCode.accessRequest;
    if (!accessRequest || (accessRequest.status !== 'pending_claim' && accessRequest.status !== 'pending')) {
      return res.send(renderDeviceCodeEntryPage(code, 'No pending authorization for this code'));
    }

    // Store the code and request ID in session
    req.session.deviceAuthCode = code;
    req.session.deviceAuthRequestId = accessRequest.id;

    // Check if user is logged in
    const userId = (req.session as { userId?: string }).userId;

    if (userId) {
      // User is logged in - show approval page directly
      // First, claim the code if not already claimed
      if (accessRequest.status === 'pending_claim') {
        await prisma.$transaction(async (tx) => {
          await tx.pairingCode.update({
            where: { id: pairingCode.id },
            data: { userId },
          });
          await tx.accessRequest.update({
            where: { id: accessRequest.id },
            data: { status: 'pending' },
          });
        });
      }

      return res.send(renderApprovalPage(
        accessRequest.id,
        accessRequest.agentName,
        accessRequest.agentDescription,
        accessRequest.requestedPermissions,
        {
          perTransaction: accessRequest.requestedPerTransaction.toString(),
          daily: accessRequest.requestedDailyLimit.toString(),
          monthly: accessRequest.requestedMonthlyLimit.toString(),
          currency: accessRequest.requestedCurrency,
        },
        accessRequest.expiresAt
      ));
    }

    // User not logged in - show login page
    return res.send(renderLoginPage(accessRequest.agentName, accessRequest.id));
  } catch (error) {
    console.error('[Device Auth Web] Lookup error:', error);
    return res.send(renderErrorPage('An error occurred. Please try again.'));
  }
});

/**
 * GET /api/m/device/login
 * Show login page (if someone navigates here directly)
 */
router.get('/login', (req: Request, res: Response) => {
  const requestId = req.session.deviceAuthRequestId;
  if (!requestId) {
    return res.redirect('/api/m/device');
  }

  // Get the agent name from the access request
  prisma.accessRequest.findUnique({
    where: { id: requestId },
  }).then(accessRequest => {
    if (!accessRequest) {
      return res.redirect('/api/m/device');
    }
    res.send(renderLoginPage(accessRequest.agentName, requestId));
  }).catch(() => {
    res.redirect('/api/m/device');
  });
});

/**
 * POST /api/m/device/login/identify
 * Send login push notification to user
 */
router.post('/login/identify', async (req: Request, res: Response) => {
  try {
    const { email, request_id } = req.body;

    if (!email || !request_id) {
      return res.send(renderErrorPage('Missing email or request ID'));
    }

    // Find user by email
    const user = await prisma.walletUser.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!user) {
      // Don't reveal whether user exists - show generic message
      // but we'll create a fake wait page that times out
      const fakeId = `fake-${Date.now()}`;
      req.session.loginRequestId = fakeId;
      return res.send(renderWaitingPage(fakeId));
    }

    // Create a device auth login request
    const { nanoid } = await import('nanoid');
    const loginId = nanoid(16);

    // Store the login request in the database
    await prisma.oAuthAuthorizationCode.create({
      data: {
        id: loginId,
        clientId: 'device-auth-web',
        userId: user.id,
        redirectUri: `${env.APP_URL}/api/m/device/approve`,
        codeChallenge: null,
        codeChallengeMethod: null,
        scope: 'device-auth',
        status: 'pending_approval',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minute expiry
      },
    });

    req.session.loginRequestId = loginId;

    // Send push notification
    try {
      await sendNotificationToUser(
        user.id,
        'oauth.authorization',
        {
          title: 'Sign-in Request',
          body: 'Tap to approve web sign-in',
          data: {
            type: 'oauth.authorization',
            screen: 'OAuthAuthorization',
            params: { oauthAuthorizationId: loginId },
            authorization_id: loginId,
            client_name: 'WSIM Web',
          },
        },
        loginId
      );
    } catch (notifError) {
      console.error('[Device Auth Web] Failed to send notification:', notifError);
      // Continue - user might have app open
    }

    console.log(`[Device Auth Web] Login request ${loginId} created for user ${user.id}`);

    return res.send(renderWaitingPage(loginId));
  } catch (error) {
    console.error('[Device Auth Web] Identify error:', error);
    return res.send(renderErrorPage('An error occurred. Please try again.'));
  }
});

/**
 * GET /api/m/device/login/wait/:id
 * Poll for login approval (meta refresh)
 */
router.get('/login/wait/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Check for fake IDs (user doesn't exist)
    if (id.startsWith('fake-')) {
      const fakeTime = parseInt(id.replace('fake-', ''), 10);
      if (Date.now() - fakeTime > 60 * 1000) {
        // 1 minute timeout for fake requests
        return res.send(renderErrorPage('Sign-in request timed out. Please try again.'));
      }
      return res.send(renderWaitingPage(id));
    }

    const authRequest = await prisma.oAuthAuthorizationCode.findUnique({
      where: { id },
    });

    if (!authRequest) {
      return res.send(renderErrorPage('Sign-in request not found'));
    }

    if (authRequest.expiresAt < new Date()) {
      await prisma.oAuthAuthorizationCode.update({
        where: { id },
        data: { status: 'expired' },
      });
      return res.send(renderErrorPage('Sign-in request expired. Please try again.'));
    }

    if (authRequest.status === 'approved') {
      // User approved in mobile app - log them in
      (req.session as { userId?: string }).userId = authRequest.userId || undefined;

      // Get the device auth request
      const requestId = req.session.deviceAuthRequestId;
      const code = req.session.deviceAuthCode;

      if (!requestId || !code) {
        return res.redirect('/api/m/device');
      }

      const accessRequest = await prisma.accessRequest.findUnique({
        where: { id: requestId },
        include: { pairingCode: true },
      });

      if (!accessRequest) {
        return res.redirect('/api/m/device');
      }

      // Claim the code if not already claimed
      if (accessRequest.status === 'pending_claim') {
        await prisma.$transaction(async (tx) => {
          await tx.pairingCode.update({
            where: { id: accessRequest.pairingCodeId },
            data: { userId: authRequest.userId },
          });
          await tx.accessRequest.update({
            where: { id: accessRequest.id },
            data: { status: 'pending' },
          });
        });
      }

      // Show approval page
      return res.send(renderApprovalPage(
        accessRequest.id,
        accessRequest.agentName,
        accessRequest.agentDescription,
        accessRequest.requestedPermissions,
        {
          perTransaction: accessRequest.requestedPerTransaction.toString(),
          daily: accessRequest.requestedDailyLimit.toString(),
          monthly: accessRequest.requestedMonthlyLimit.toString(),
          currency: accessRequest.requestedCurrency,
        },
        accessRequest.expiresAt
      ));
    }

    if (authRequest.status === 'rejected') {
      return res.send(renderErrorPage('Sign-in was rejected. Please try again.'));
    }

    // Still pending - show waiting page
    return res.send(renderWaitingPage(id));
  } catch (error) {
    console.error('[Device Auth Web] Wait error:', error);
    return res.send(renderErrorPage('An error occurred. Please try again.'));
  }
});

/**
 * GET /api/m/device/login/status/:id
 * JSON endpoint for polling login status (for JS-enabled clients)
 */
router.get('/login/status/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (id.startsWith('fake-')) {
      return res.json({ status: 'pending' });
    }

    const authRequest = await prisma.oAuthAuthorizationCode.findUnique({
      where: { id },
    });

    if (!authRequest) {
      return res.json({ status: 'not_found' });
    }

    if (authRequest.expiresAt < new Date()) {
      return res.json({ status: 'expired' });
    }

    return res.json({ status: authRequest.status });
  } catch (error) {
    console.error('[Device Auth Web] Status error:', error);
    return res.json({ status: 'error' });
  }
});

/**
 * GET /api/m/device/approve
 * Show approval page (for direct navigation)
 */
router.get('/approve', async (req: Request, res: Response) => {
  try {
    const userId = (req.session as { userId?: string }).userId;
    const requestId = req.session.deviceAuthRequestId;

    if (!userId) {
      return res.redirect('/api/m/device');
    }

    if (!requestId) {
      return res.redirect('/api/m/device');
    }

    const accessRequest = await prisma.accessRequest.findUnique({
      where: { id: requestId },
    });

    if (!accessRequest) {
      return res.send(renderErrorPage('Access request not found'));
    }

    if (accessRequest.status !== 'pending' && accessRequest.status !== 'pending_claim') {
      return res.send(renderErrorPage(`This request is already ${accessRequest.status}`));
    }

    if (accessRequest.expiresAt < new Date()) {
      return res.send(renderErrorPage('This request has expired'));
    }

    return res.send(renderApprovalPage(
      accessRequest.id,
      accessRequest.agentName,
      accessRequest.agentDescription,
      accessRequest.requestedPermissions,
      {
        perTransaction: accessRequest.requestedPerTransaction.toString(),
        daily: accessRequest.requestedDailyLimit.toString(),
        monthly: accessRequest.requestedMonthlyLimit.toString(),
        currency: accessRequest.requestedCurrency,
      },
      accessRequest.expiresAt
    ));
  } catch (error) {
    console.error('[Device Auth Web] Approve page error:', error);
    return res.send(renderErrorPage('An error occurred'));
  }
});

/**
 * POST /api/m/device/approve
 * Approve the device authorization request
 */
router.post('/approve', async (req: Request, res: Response) => {
  try {
    const userId = (req.session as { userId?: string }).userId;
    const requestId = req.body.request_id || req.session.deviceAuthRequestId;

    if (!userId) {
      return res.redirect('/api/m/device');
    }

    if (!requestId) {
      return res.send(renderErrorPage('No request to approve'));
    }

    const accessRequest = await prisma.accessRequest.findUnique({
      where: { id: requestId },
      include: { pairingCode: true },
    });

    if (!accessRequest) {
      return res.send(renderErrorPage('Access request not found'));
    }

    // Verify ownership
    if (accessRequest.pairingCode.userId !== userId) {
      return res.send(renderErrorPage('This request does not belong to you'));
    }

    if (accessRequest.status !== 'pending') {
      return res.send(renderErrorPage(`This request is already ${accessRequest.status}`));
    }

    if (accessRequest.expiresAt < new Date()) {
      await prisma.accessRequest.update({
        where: { id: accessRequest.id },
        data: { status: 'expired' },
      });
      return res.send(renderErrorPage('This request has expired'));
    }

    // Generate credentials
    const clientId = generateAgentClientId();
    const clientSecret = generateAgentClientSecret();
    const clientSecretHash = await hashClientSecret(clientSecret);

    // Create agent and update request
    await prisma.$transaction(async (tx) => {
      const agent = await tx.agent.create({
        data: {
          userId,
          clientId,
          clientSecretHash,
          name: accessRequest.agentName,
          description: accessRequest.agentDescription,
          permissions: accessRequest.requestedPermissions,
          perTransactionLimit: accessRequest.requestedPerTransaction,
          dailyLimit: accessRequest.requestedDailyLimit,
          monthlyLimit: accessRequest.requestedMonthlyLimit,
          limitCurrency: accessRequest.requestedCurrency,
        },
      });

      await tx.accessRequest.update({
        where: { id: accessRequest.id },
        data: {
          status: 'approved',
          grantedPermissions: accessRequest.requestedPermissions,
          grantedPerTransaction: accessRequest.requestedPerTransaction,
          grantedDailyLimit: accessRequest.requestedDailyLimit,
          grantedMonthlyLimit: accessRequest.requestedMonthlyLimit,
          agentId: agent.id,
          resolvedAt: new Date(),
        },
      });

      await tx.pairingCode.update({
        where: { id: accessRequest.pairingCodeId },
        data: {
          status: 'used',
          usedAt: new Date(),
        },
      });
    });

    // Clear session data
    delete req.session.deviceAuthCode;
    delete req.session.deviceAuthRequestId;

    console.log(`[Device Auth Web] User ${userId} approved request ${requestId}`);

    return res.send(renderSuccessPage('approved', accessRequest.agentName));
  } catch (error) {
    console.error('[Device Auth Web] Approve error:', error);
    return res.send(renderErrorPage('Failed to approve request'));
  }
});

/**
 * POST /api/m/device/reject
 * Reject the device authorization request
 */
router.post('/reject', async (req: Request, res: Response) => {
  try {
    const userId = (req.session as { userId?: string }).userId;
    const requestId = req.body.request_id || req.session.deviceAuthRequestId;

    if (!userId) {
      return res.redirect('/api/m/device');
    }

    if (!requestId) {
      return res.send(renderErrorPage('No request to reject'));
    }

    const accessRequest = await prisma.accessRequest.findUnique({
      where: { id: requestId },
      include: { pairingCode: true },
    });

    if (!accessRequest) {
      return res.send(renderErrorPage('Access request not found'));
    }

    // Verify ownership
    if (accessRequest.pairingCode.userId !== userId) {
      return res.send(renderErrorPage('This request does not belong to you'));
    }

    if (accessRequest.status !== 'pending') {
      return res.send(renderErrorPage(`This request is already ${accessRequest.status}`));
    }

    // Update request
    await prisma.accessRequest.update({
      where: { id: accessRequest.id },
      data: {
        status: 'rejected',
        rejectionReason: 'User rejected via web',
        resolvedAt: new Date(),
      },
    });

    await prisma.pairingCode.update({
      where: { id: accessRequest.pairingCodeId },
      data: {
        status: 'used',
        usedAt: new Date(),
      },
    });

    // Clear session data
    delete req.session.deviceAuthCode;
    delete req.session.deviceAuthRequestId;

    console.log(`[Device Auth Web] User ${userId} rejected request ${requestId}`);

    return res.send(renderSuccessPage('rejected', accessRequest.agentName));
  } catch (error) {
    console.error('[Device Auth Web] Reject error:', error);
    return res.send(renderErrorPage('Failed to reject request'));
  }
});

// =============================================================================
// FALLBACK AUTH ROUTES (for optimized flow when push doesn't arrive)
// =============================================================================

/**
 * POST /api/m/device/login/password
 * Authenticate with email + password (fallback for when push doesn't arrive)
 */
router.post('/login/password', async (req: Request, res: Response) => {
  try {
    const { email, password, login_id } = req.body;

    if (!email || !password || !login_id) {
      return res.send(renderErrorPage('Missing email, password, or login ID'));
    }

    // Find user by email
    const user = await prisma.walletUser.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!user || !user.passwordHash) {
      // Generic error to prevent user enumeration
      return res.send(renderErrorPage('Invalid email or password'));
    }

    // Verify password
    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      console.log(`[Device Auth Web] Password auth failed for ${email}`);
      return res.send(renderErrorPage('Invalid email or password'));
    }

    // Verify the login request belongs to this user
    const authRequest = await prisma.oAuthAuthorizationCode.findUnique({
      where: { id: login_id },
    });

    if (!authRequest || authRequest.userId !== user.id) {
      return res.send(renderErrorPage('Invalid or expired login request'));
    }

    if (authRequest.expiresAt < new Date()) {
      return res.send(renderErrorPage('Login request expired. Please try again.'));
    }

    // Mark the auth request as approved and set session
    await prisma.oAuthAuthorizationCode.update({
      where: { id: login_id },
      data: { status: 'approved' },
    });

    (req.session as { userId?: string }).userId = user.id;

    console.log(`[Device Auth Web] Password auth success for user ${user.id.substring(0, 8)}...`);

    // Redirect to approval page
    return res.redirect('/api/m/device/approve');
  } catch (error) {
    console.error('[Device Auth Web] Password auth error:', error);
    return res.send(renderErrorPage('Authentication failed. Please try again.'));
  }
});

/**
 * POST /api/m/device/login/passkey/options
 * Generate passkey authentication options (fallback auth)
 */
router.post('/login/passkey/options', async (req: Request, res: Response) => {
  try {
    const { login_id } = req.body;

    if (!login_id) {
      return res.status(400).json({ error: 'Missing login_id' });
    }

    // Get the auth request to find the user
    const authRequest = await prisma.oAuthAuthorizationCode.findUnique({
      where: { id: login_id },
    });

    if (!authRequest || !authRequest.userId) {
      return res.status(400).json({ error: 'Invalid login request' });
    }

    if (authRequest.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Login request expired' });
    }

    // Get user's passkey credentials
    const credentials = await prisma.passkeyCredential.findMany({
      where: { userId: authRequest.userId },
      select: { credentialId: true, transports: true },
    });

    if (credentials.length === 0) {
      return res.status(400).json({ error: 'No passkeys registered' });
    }

    const options = await generateAuthenticationOptions({
      rpID: env.WEBAUTHN_RP_ID,
      allowCredentials: credentials.map((c) => ({
        id: c.credentialId,
        transports: c.transports.includes('internal')
          ? ['internal'] as AuthenticatorTransportFuture[]
          : c.transports as AuthenticatorTransportFuture[],
      })),
      userVerification: 'preferred',
    });

    // Store challenge for verification
    storePasskeyChallenge(login_id, options.challenge, authRequest.userId);

    res.json(options);
  } catch (error) {
    console.error('[Device Auth Web] Passkey options error:', error);
    res.status(500).json({ error: 'Failed to generate options' });
  }
});

/**
 * POST /api/m/device/login/passkey/verify
 * Verify passkey authentication response (fallback auth)
 */
router.post('/login/passkey/verify', async (req: Request, res: Response) => {
  try {
    const { login_id, response } = req.body as {
      login_id: string;
      response: AuthenticationResponseJSON;
    };

    if (!login_id || !response) {
      return res.status(400).json({ error: 'Missing login_id or response' });
    }

    // Get the stored challenge
    const challengeData = getPasskeyChallenge(login_id);
    if (!challengeData) {
      return res.status(400).json({ error: 'Challenge expired or not found' });
    }

    // Find the credential
    const credential = await prisma.passkeyCredential.findUnique({
      where: { credentialId: response.id },
      include: { user: true },
    });

    if (!credential) {
      return res.status(400).json({ error: 'Credential not found' });
    }

    // Verify the credential belongs to the expected user
    if (credential.userId !== challengeData.userId) {
      return res.status(400).json({ error: 'Credential mismatch' });
    }

    let verification: VerifiedAuthenticationResponse;
    try {
      const publicKeyBuffer = Buffer.from(credential.publicKey, 'base64url');
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challengeData.challenge,
        expectedOrigin: env.WEBAUTHN_ORIGINS,
        expectedRPID: env.WEBAUTHN_RP_ID,
        credential: {
          id: credential.credentialId,
          publicKey: new Uint8Array(publicKeyBuffer),
          counter: credential.counter,
          transports: credential.transports as AuthenticatorTransportFuture[],
        },
      });
    } catch (verifyError) {
      console.error('[Device Auth Web] Passkey verification failed:', verifyError);
      return res.status(400).json({ error: 'Verification failed' });
    }

    if (!verification.verified) {
      return res.status(400).json({ error: 'Verification failed' });
    }

    // Update credential counter
    await prisma.passkeyCredential.update({
      where: { id: credential.id },
      data: {
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      },
    });

    // Mark the auth request as approved
    await prisma.oAuthAuthorizationCode.update({
      where: { id: login_id },
      data: { status: 'approved' },
    });

    // Set session
    (req.session as { userId?: string }).userId = credential.userId;

    console.log(`[Device Auth Web] Passkey auth success for user ${credential.userId.substring(0, 8)}...`);

    res.json({ success: true });
  } catch (error) {
    console.error('[Device Auth Web] Passkey verify error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

export default router;

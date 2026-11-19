import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { paynectaService } from './src/services/paynectaService';
import {
  getSupabaseClient,
  isSupabaseTransportError,
  markSupabaseUnreachable,
  shouldUseLocalFallback,
} from './src/services/supabaseService';
import {
  localFallbackStore,
  SEEDED_ADMINS,
  LEGACY_PROTECTED_ADMIN_PASSWORD_HASH,
} from './server/localFallbackStore';
import { marketEngine } from './server/marketEngine';
import { adminRiskStore, isProtectedAdminUser, RiskSessionError } from './server/adminRiskStore';

dotenv.config();
marketEngine.startLoop();

const app = express();
app.set('trust proxy', 1);
export { app };

async function withStoreFallback<T>(
  supabaseFn: () => Promise<T>,
  localFn: () => T | Promise<T>
): Promise<T> {
  if (await shouldUseLocalFallback()) {
    return await localFn();
  }
  try {
    return await supabaseFn();
  } catch (err) {
    if (isSupabaseTransportError(err)) {
      markSupabaseUnreachable();
      return await localFn();
    }
    throw err;
  }
}

// Restrict credentialed cross-origin requests to configured application origins.
const allowedOrigins = new Set(
  [process.env.APP_URL, process.env.APP_BASE_URL, process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '']
    .filter((value): value is string => Boolean(value))
    .map((value) => value.replace(/\/+$/, ''))
);
if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.add('http://localhost:3000');
  allowedOrigins.add('http://localhost:5173');
}

// Normalize incoming request path across Vercel serverless function invocation styles
app.use((req: Request, _res: Response, next: NextFunction) => {
  if (req.url.startsWith('/api/index')) {
    req.url = req.url.replace(/^\/api\/index/, '/api') || '/api';
  } else if (process.env.VERCEL && !req.url.startsWith('/api') && !req.url.startsWith('/?')) {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }
  next();
});

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin) {
    const isAllowed =
      allowedOrigins.has(origin.replace(/\/+$/, '')) ||
      /^https:\/\/[a-zA-Z0-9_-]+\.vercel\.app$/.test(origin) ||
      /^https:\/\/[a-zA-Z0-9._-]+\.run\.app$/.test(origin);
    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-auth-token, paynecta-signature, paynecta-timestamp');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// Cookie Helpers
function parseCookies(cookieHeader?: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [name, ...rest] = part.trim().split('=');
    if (name && rest.length > 0) {
      cookies[name] = decodeURIComponent(rest.join('='));
    }
  }
  return cookies;
}

function isHttpsRequest(req: Request): boolean {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return req.secure || proto === 'https' || process.env.NODE_ENV === 'production';
}

function setSessionCookie(req: Request, res: Response, token: string) {
  const https = isHttpsRequest(req);
  const cookieParts = [
    `devoptions_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    https ? 'SameSite=None' : 'SameSite=Lax',
    `Max-Age=${7 * 24 * 60 * 60}`,
    https ? 'Secure' : '',
  ].filter(Boolean);
  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

function clearSessionCookie(req: Request, res: Response) {
  const https = isHttpsRequest(req);
  const cookieParts = [
    'devoptions_session=',
    'Path=/',
    'HttpOnly',
    https ? 'SameSite=None' : 'SameSite=Lax',
    'Max-Age=0',
    https ? 'Secure' : '',
  ].filter(Boolean);
  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

// ─────────────────────────────────────────────────────────────
// DATA PERSISTENCE & DATABASE LAYER
// ─────────────────────────────────────────────────────────────
interface UserRecord {
  id: string;
  email: string;
  phone: string; // E.164 formatted
  passwordHash: string;
  salt: string;
  role?: 'admin' | 'user';
  createdAt: number;
  emailVerified: boolean;
  phoneVerified: boolean;
  emailVerificationCode?: string;
  emailVerificationExpires?: number;
  phoneVerificationCode?: string;
  phoneVerificationExpires?: number;
  resetPasswordToken?: string;
  resetPasswordExpires?: number;
  demoBalance: number;
  realBalance: number;
  fullName?: string;
  country?: string;
  theme?: string;
  soundEnabled?: boolean;
}

interface SessionRecord {
  token: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

export interface DepositRecord {
  id: string;
  userId: string;
  merchantReference: string;
  amountKes: number;
  amountSubunits: number;
  amountUsd: number;
  currency: 'KES';
  sessionId?: string;
  checkoutUrl?: string;
  providerReference?: string;
  receiptNumber?: string;
  status: 'pending' | 'verifying' | 'succeeded' | 'cancelled' | 'failed' | 'verification_delayed';
  failureReason?: string;
  confirmedAmountKes?: number;
  createdAt: number;
  updatedAt: number;
  confirmedAt?: number;
}

// ─────────────────────────────────────────────────────────────
// SECURITY & CRYPTOGRAPHY UTILITIES
// ─────────────────────────────────────────────────────────────
function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password: string, salt: string, storedHash: string): boolean {
  if (!password || !salt || !storedHash) return false;
  try {
    const hash = crypto.scryptSync(password, salt, 64);
    const storedBuf = Buffer.from(storedHash, 'hex');
    if (hash.length !== storedBuf.length) return false;
    return crypto.timingSafeEqual(hash, storedBuf);
  } catch {
    return false;
  }
}

function generateSecureOtp(): string {
  // 6-digit random number
  const num = crypto.randomInt(100000, 999999);
  return num.toString();
}

function getSessionSigningSecret(): string {
  return (
    process.env.AUTH_SESSION_SECRET ||
    process.env.JWT_SECRET ||
    process.env.SUPABASE_SECRET_KEY ||
    'devoptions-hmac-session-key-v1'
  );
}

function computePasswordVersion(passwordHash: string, salt: string): string {
  return crypto
    .createHash('sha256')
    .update(`${passwordHash}:${salt}`)
    .digest('hex')
    .slice(0, 16);
}

interface SignedTokenPayload {
  v: 1;
  sid: string;
  uid: string;
  iat: number;
  exp: number;
  pv: string;
}

function issueSignedSessionToken(
  user: { id: string; passwordHash: string; salt: string },
  now: number,
  expiresAt: number
): string {
  const payload: SignedTokenPayload = {
    v: 1,
    sid: crypto.randomBytes(16).toString('hex'),
    uid: user.id,
    iat: now,
    exp: expiresAt,
    pv: computePasswordVersion(user.passwordHash, user.salt),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sigB64 = crypto
    .createHmac('sha256', getSessionSigningSecret())
    .update(payloadB64)
    .digest('base64url');
  return `v1.${payloadB64}.${sigB64}`;
}

function verifySignedSessionToken(token: string): SignedTokenPayload | null {
  if (!token || !token.startsWith('v1.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;
  try {
    const expectedSig = crypto
      .createHmac('sha256', getSessionSigningSecret())
      .update(payloadB64)
      .digest('base64url');
    const a = Buffer.from(sigB64, 'utf8');
    const b = Buffer.from(expectedSig, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (
      !decoded ||
      decoded.v !== 1 ||
      typeof decoded.sid !== 'string' ||
      typeof decoded.uid !== 'string' ||
      typeof decoded.iat !== 'number' ||
      typeof decoded.exp !== 'number' ||
      typeof decoded.pv !== 'string'
    ) {
      return null;
    }
    return decoded as SignedTokenPayload;
  } catch {
    return null;
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizePhone(phone: string): string {
  let cleaned = phone.trim().replace(/[\s\-\(\)\.]/g, '').replace(/^\++/, '+');
  if (/^\+0[17]\d{8}$/.test(cleaned)) {
    cleaned = cleaned.slice(1);
  }
  if (/^\+2540([17]\d{8})$/.test(cleaned)) {
    cleaned = cleaned.replace(/^\+2540([17]\d{8})$/, '+254$1');
  }
  // If user entered Kenyan 07XX or 01XX (10 digits starting with 0)
  if (/^0[17]\d{8}$/.test(cleaned)) {
    return '+254' + cleaned.substring(1);
  }
  // If user entered 10-digit North American number
  if (/^[2-9]\d{9}$/.test(cleaned)) {
    return '+1' + cleaned;
  }
  if (!cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;
  }
  return cleaned;
}

function validateEmail(email: string): boolean {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

function validatePhone(phone: string): boolean {
  // E.164: + followed by 7 to 15 digits
  const re = /^\+[1-9]\d{6,14}$/;
  return re.test(phone);
}

function validatePasswordSecurity(password: string): { isValid: boolean; message?: string } {
  if (password.length < 8) {
    return { isValid: false, message: 'Password must be at least 8 characters long.' };
  }
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumberOrSymbol = /[\d!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
  if (!hasLetter || !hasNumberOrSymbol) {
    return {
      isValid: false,
      message: 'Password must contain both letters and at least one number or symbol.',
    };
  }
  return { isValid: true };
}

// ─────────────────────────────────────────────────────────────
// IN-MEMORY RATE LIMITING FOR AUTH BRUTE FORCE PROTECTION
// ─────────────────────────────────────────────────────────────
interface RateLimitBucket {
  count: number;
  resetAt: number;
}
const rateLimits = new Map<string, RateLimitBucket>();

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function pruneExpiredRateLimits(now: number) {
  if (rateLimits.size < 500) return;
  for (const [k, v] of rateLimits.entries()) {
    if (v.resetAt < now) rateLimits.delete(k);
  }
}

function rateLimitMiddleware(limit = 15, windowMs = 60 * 1000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = getClientIp(req);
    const key = `${ip}:${req.path}`;
    const now = Date.now();
    pruneExpiredRateLimits(now);

    const bucket = rateLimits.get(key);
    if (!bucket || bucket.resetAt < now) {
      rateLimits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    bucket.count += 1;
    if (bucket.count > limit) {
      return res.status(429).json({
        error: 'Too many requests. Please wait a moment before trying again.',
      });
    }

    next();
  };
}

function loginFailureRateLimitMiddleware(maxFailures = 20, windowMs = 60 * 1000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = getClientIp(req);
    const rawId = String(req.body?.identifier || req.body?.email || req.body?.phone || '')
      .trim()
      .toLowerCase();
    const key = `login:${ip}:${rawId || 'anon'}`;
    const now = Date.now();
    pruneExpiredRateLimits(now);

    const bucket = rateLimits.get(key);
    if (bucket && bucket.resetAt >= now && bucket.count >= maxFailures) {
      return res.status(429).json({
        error: 'Too many failed login attempts. Please wait a minute and try again.',
      });
    }

    res.on('finish', () => {
      const doneAt = Date.now();
      if (res.statusCode >= 200 && res.statusCode < 300) {
        rateLimits.delete(key);
      } else if (res.statusCode === 401) {
        const cur = rateLimits.get(key);
        if (!cur || cur.resetAt < doneAt) {
          rateLimits.set(key, { count: 1, resetAt: doneAt + windowMs });
        } else {
          cur.count += 1;
        }
      }
    });

    next();
  };
}

// ─────────────────────────────────────────────────────────────
// AUTHENTICATION MIDDLEWARE
// ─────────────────────────────────────────────────────────────
interface AuthenticatedRequest extends Request {
  user?: UserRecord;
  sessionToken?: string;
  sessionExpiresAt?: number;
}

async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    let token: string | undefined;

    // 1. Check Bearer Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1]?.trim();
    }

    // 2. Check x-auth-token header
    if (!token && req.headers['x-auth-token']) {
      token = String(req.headers['x-auth-token']).trim();
    }

    // 3. Check devoptions_session cookie
    if (!token && req.headers.cookie) {
      const cookies = parseCookies(req.headers.cookie);
      if (cookies['devoptions_session']) {
        token = cookies['devoptions_session'].trim();
      }
    }

    if (!token) {
      return res.status(401).json({
        error: 'Not logged in',
        message: 'Please log in to continue.',
        code: 'AUTH_REQUIRED',
      });
    }

    const authResult = await withStoreFallback(
      async () => {
        const supabase = getSupabaseClient();
        const { data: session, error: sessionError } = await supabase
          .from('sessions')
          .select('*')
          .eq('token', token)
          .maybeSingle();

        if (sessionError) {
          if (isSupabaseTransportError(sessionError)) throw sessionError;
          return { status: 500 as const, body: { error: 'Could not verify session.' } };
        }

        if (!session) {
          return {
            status: 401 as const,
            body: {
              error: 'Invalid token',
              message: 'Authentication could not be verified.',
              code: 'INVALID_TOKEN',
            },
          };
        }

        if (Number(session.expires_at) < Date.now()) {
          await supabase.from('sessions').delete().eq('token', token);
          return {
            status: 401 as const,
            body: {
              error: 'Session expired',
              message: 'Your session has expired. Please log in again.',
              code: 'SESSION_EXPIRED',
            },
          };
        }

        const { data: row, error: userError } = await supabase
          .from('users')
          .select('*')
          .eq('id', session.user_id)
          .maybeSingle();

        if (userError) {
          if (isSupabaseTransportError(userError)) throw userError;
          return { status: 500 as const, body: { error: 'Could not verify account.' } };
        }

        if (!row) {
          return {
            status: 401 as const,
            body: {
              error: 'Account inactive',
              message: 'Contact support for assistance.',
              code: 'ACCOUNT_INACTIVE',
            },
          };
        }

        return { status: 200 as const, user: userFromRow(row), expiresAt: Number(session.expires_at) };
      },
      () => {
        const now = Date.now();
        const session = localFallbackStore.findSession(token!);
        if (session) {
          if (Number(session.expires_at) < now) {
            localFallbackStore.deleteSession(token!);
            return {
              status: 401 as const,
              body: {
                error: 'Session expired',
                message: 'Your session has expired. Please log in again.',
                code: 'SESSION_EXPIRED',
              },
            };
          }
          const row = localFallbackStore.findUserById(session.user_id);
          if (!row) {
            return {
              status: 401 as const,
              body: {
                error: 'Account inactive',
                message: 'Contact support for assistance.',
                code: 'ACCOUNT_INACTIVE',
              },
            };
          }
          return { status: 200 as const, user: userFromRow(row), expiresAt: Number(session.expires_at) };
        }

        // Stateless signed-token verification fallback when local session store resets across container restarts
        const signed = verifySignedSessionToken(token!);
        if (!signed) {
          return {
            status: 401 as const,
            body: {
              error: 'Invalid token',
              message: 'Authentication could not be verified.',
              code: 'INVALID_TOKEN',
            },
          };
        }
        if (signed.exp < now) {
          return {
            status: 401 as const,
            body: {
              error: 'Session expired',
              message: 'Your session has expired. Please log in again.',
              code: 'SESSION_EXPIRED',
            },
          };
        }
        if (localFallbackStore.isSessionIdRevoked(signed.sid)) {
          return {
            status: 401 as const,
            body: {
              error: 'Session expired',
              message: 'Your session has ended. Please log in again.',
              code: 'SESSION_EXPIRED',
            },
          };
        }
        const row = localFallbackStore.findUserById(signed.uid);
        if (!row) {
          return {
            status: 401 as const,
            body: {
              error: 'Account inactive',
              message: 'Contact support for assistance.',
              code: 'ACCOUNT_INACTIVE',
            },
          };
        }
        if (row.token_valid_after && signed.iat < Number(row.token_valid_after)) {
          return {
            status: 401 as const,
            body: {
              error: 'Session expired',
              message: 'Credentials changed. Please log in again.',
              code: 'SESSION_EXPIRED',
            },
          };
        }
        if (signed.pv !== computePasswordVersion(row.password_hash, row.salt)) {
          return {
            status: 401 as const,
            body: {
              error: 'Session expired',
              message: 'Credentials changed. Please log in again.',
              code: 'SESSION_EXPIRED',
            },
          };
        }
        // Re-hydrate local session list for metrics & consistency
        localFallbackStore.insertSession({
          token: token!,
          user_id: row.id,
          created_at: signed.iat,
          expires_at: signed.exp,
        });
        return { status: 200 as const, user: userFromRow(row), expiresAt: signed.exp };
      }
    );

    if (authResult.status !== 200) {
      return res.status(authResult.status).json(authResult.body);
    }

    req.user = authResult.user;
    req.sessionToken = token;
    req.sessionExpiresAt = authResult.expiresAt;

    return next();
  } catch (err) {
    console.error('[Authentication Error]:', err);
    return res.status(500).json({ error: 'Authentication service unavailable.' });
  }
}

async function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  await requireAuth(req, res, () => {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied: Administrator privileges required.' });
    }
    next();
  });
}

function safeUserResponse(user: UserRecord, lastEmailOtp?: string, lastPhoneOtp?: string) {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    role: user.role || 'user',
    emailVerified: user.emailVerified,
    phoneVerified: user.phoneVerified,
    demoBalance: user.demoBalance,
    realBalance: user.realBalance,
    balances: { demo: user.demoBalance, real: user.realBalance },
    fullName: user.fullName || '',
    country: user.country || 'International',
    createdAt: user.createdAt,
    emailProviderConfigured: hasSmtpConfig(),
    smsProviderConfigured: hasTwilioConfig(),
    devNotice:
      !user.emailVerified || !user.phoneVerified
        ? {
            emailOtp: process.env.NODE_ENV !== 'production' && !user.emailVerified ? lastEmailOtp || user.emailVerificationCode : undefined,
            phoneOtp: process.env.NODE_ENV !== 'production' && !user.phoneVerified ? lastPhoneOtp || user.phoneVerificationCode : undefined,
            info: process.env.NODE_ENV !== 'production'
              ? 'Development verification codes are shown in this notice.'
              : [
                  !user.emailVerified && !hasSmtpConfig() ? 'Email delivery is not configured.' : '',
                  !user.phoneVerified && !hasTwilioConfig() ? 'SMS delivery is not configured.' : '',
                ].filter(Boolean).join(' ') || 'Verification codes have been sent through the configured providers.',
            emailConfigured: hasSmtpConfig(),
            smsConfigured: hasTwilioConfig(),
          }
        : undefined,
  };
}

// Verification delivery is server-side only. Codes are never returned to production clients.
function hasSmtpConfig(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_FROM);
}
function hasTwilioConfig(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);
}
async function sendEmailCode(to: string, code: string, purpose: 'verification' | 'password reset'): Promise<void> {
  if (!hasSmtpConfig()) throw new Error('SMTP delivery is not configured.');
  const { createTransport } = await import('nodemailer');
  const port = Number(process.env.SMTP_PORT || 587);
  const transporter = createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: purpose === 'verification' ? 'Your DevOptions verification code' : 'Your DevOptions password reset code',
    text: `Your DevOptions ${purpose} code is ${code}. It expires in ${purpose === 'verification' ? '15' : '30'} minutes. If you did not request this, ignore this message.`,
  });
}
async function sendSmsCode(to: string, code: string, purpose: 'verification' | 'password reset'): Promise<void> {
  if (!hasTwilioConfig()) throw new Error('Twilio SMS delivery is not configured.');
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const credentials = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const body = new URLSearchParams({
    To: to,
    From: process.env.TWILIO_PHONE_NUMBER!,
    Body: `Your DevOptions ${purpose} code is ${code}. It expires in ${purpose === 'verification' ? '15' : '30'} minutes.`,
  });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) throw new Error(`Twilio message delivery failed (${response.status}).`);
}
async function dispatchVerificationCodes(user: UserRecord, emailCode?: string, phoneCode?: string): Promise<void> {
  const tasks: Promise<void>[] = [];
  if (emailCode && hasSmtpConfig()) tasks.push(sendEmailCode(user.email, emailCode, 'verification'));
  if (phoneCode && hasTwilioConfig()) tasks.push(sendSmsCode(user.phone, phoneCode, 'verification'));
  const results = await Promise.allSettled(tasks);
  results.forEach((result) => {
    if (result.status === 'rejected') console.error('[Verification Delivery Error]:', result.reason instanceof Error ? result.reason.message : 'Delivery failed');
  });
}
async function dispatchPasswordReset(user: UserRecord, isEmail: boolean, code: string): Promise<void> {
  try {
    if (isEmail) await sendEmailCode(user.email, code, 'password reset');
    else await sendSmsCode(user.phone, code, 'password reset');
  } catch (error) {
    console.error('[Password Reset Delivery Error]:', error instanceof Error ? error.message : 'Delivery failed');
  }
}

// ─────────────────────────────────────────────────────────────
// AUTHENTICATION API ROUTES
// ─────────────────────────────────────────────────────────────

// 1. REGISTER
app.post(
  '/api/auth/register',
  rateLimitMiddleware(10, 60000),
  async (req: Request, res: Response) => {
    try {
      const { email, phone, password, confirmPassword, fullName, name } = req.body || {};

      if (!email || !phone || !password) {
        return res.status(400).json({
          error: 'Email, phone number, and password are required.',
          message: 'Email, phone number, and password are required.',
        });
      }

      const normEmail = normalizeEmail(email);
      const normPhone = normalizePhone(phone);

      if (!validateEmail(normEmail)) {
        return res.status(400).json({ error: 'Please enter a valid email address.' });
      }

      if (!validatePhone(normPhone)) {
        return res.status(400).json({
          error: 'Please enter a valid phone number in international format.',
        });
      }

      const passCheck = validatePasswordSecurity(password);
      if (!passCheck.isValid) {
        return res.status(400).json({ error: passCheck.message });
      }

      if (!confirmPassword) {
        return res.status(400).json({ error: 'Please confirm your password.' });
      }

      if (password !== confirmPassword) {
        return res.status(400).json({ error: 'Passwords do not match.' });
      }

      const salt = crypto.randomBytes(16).toString('hex');
      const passwordHash = hashPassword(password, salt);
      const emailOtp = generateSecureOtp();
      const phoneOtp = generateSecureOtp();
      const now = Date.now();
      const otpExpiry = now + 15 * 60 * 1000;
      const userId = `usr_${crypto.randomUUID()}`;
      const sessionExpiry = now + 7 * 24 * 60 * 60 * 1000;
      const sessionToken = issueSignedSessionToken({ id: userId, passwordHash, salt }, now, sessionExpiry);

      const newUser: UserRecord = {
        id: userId,
        email: normEmail,
        phone: normPhone,
        passwordHash,
        salt,
        createdAt: now,
        emailVerified: false,
        phoneVerified: false,
        emailVerificationCode: emailOtp,
        emailVerificationExpires: otpExpiry,
        phoneVerificationCode: phoneOtp,
        phoneVerificationExpires: otpExpiry,
        demoBalance: 10000,
        realBalance: 0,
        fullName: (fullName || name || normEmail.split('@')[0] || 'Trader').trim(),
        country: 'International',
      };

      const regResult = await withStoreFallback(
        async () => {
          const supabase = getSupabaseClient();

          const { data: existingEmail, error: emailLookupErr } = await supabase
            .from('users')
            .select('id')
            .eq('email', normEmail)
            .maybeSingle();

          if (emailLookupErr && isSupabaseTransportError(emailLookupErr)) {
            throw emailLookupErr;
          }
          if (existingEmail) {
            return {
              status: 409 as const,
              body: {
                error: 'An account with this email address already exists.',
                message: 'An account with this email address already exists.',
              },
            };
          }

          const { data: existingPhone, error: phoneLookupErr } = await supabase
            .from('users')
            .select('id')
            .eq('phone', normPhone)
            .maybeSingle();

          if (phoneLookupErr && isSupabaseTransportError(phoneLookupErr)) {
            throw phoneLookupErr;
          }
          if (existingPhone) {
            return {
              status: 409 as const,
              body: {
                error: 'An account with this phone number already exists.',
                message: 'An account with this phone number already exists.',
              },
            };
          }

          const { error: userError } = await supabase.from('users').insert({
            id: newUser.id,
            email: newUser.email,
            phone: newUser.phone,
            password_hash: newUser.passwordHash,
            salt: newUser.salt,
            role: 'user',
            created_at: newUser.createdAt,
            email_verified: false,
            phone_verified: false,
            email_verification_code: emailOtp,
            email_verification_expires: otpExpiry,
            phone_verification_code: phoneOtp,
            phone_verification_expires: otpExpiry,
            demo_balance: newUser.demoBalance,
            real_balance: newUser.realBalance,
            full_name: newUser.fullName,
            country: newUser.country,
          });

          if (userError) {
            if (isSupabaseTransportError(userError)) throw userError;
            console.error('[Supabase Registration Error]:', userError);

            if (userError.code === '23505') {
              return {
                status: 409 as const,
                body: {
                  error: 'An account with this email address or phone number already exists.',
                  message: 'An account with this email address or phone number already exists.',
                },
              };
            }

            return {
              status: 500 as const,
              body: {
                error: 'Could not create your account.',
                message: 'Could not create your account.',
              },
            };
          }

          const { error: sessionError } = await supabase.from('sessions').insert({
            token: sessionToken,
            user_id: newUser.id,
            created_at: now,
            expires_at: now + 7 * 24 * 60 * 60 * 1000,
          });

          if (sessionError) {
            if (isSupabaseTransportError(sessionError)) throw sessionError;
            console.error('[Supabase Registration Session Error]:', sessionError);
            await supabase.from('users').delete().eq('id', newUser.id);

            return {
              status: 500 as const,
              body: {
                error: 'Your account was created, but we could not start your session. Please try logging in.',
                message: 'Your account was created, but we could not start your session. Please try logging in.',
              },
            };
          }

          return { status: 201 as const };
        },
        () => {
          if (localFallbackStore.findUserByEmail(normEmail)) {
            return {
              status: 409 as const,
              body: {
                error: 'An account with this email address already exists.',
                message: 'An account with this email address already exists.',
              },
            };
          }
          if (localFallbackStore.findUserByPhone(normPhone)) {
            return {
              status: 409 as const,
              body: {
                error: 'An account with this phone number already exists.',
                message: 'An account with this phone number already exists.',
              },
            };
          }
          const { error: userError } = localFallbackStore.insertUser({
            id: newUser.id,
            email: newUser.email,
            phone: newUser.phone,
            password_hash: newUser.passwordHash,
            salt: newUser.salt,
            role: 'user',
            created_at: newUser.createdAt,
            email_verified: false,
            phone_verified: false,
            email_verification_code: emailOtp,
            email_verification_expires: otpExpiry,
            phone_verification_code: phoneOtp,
            phone_verification_expires: otpExpiry,
            demo_balance: newUser.demoBalance,
            real_balance: newUser.realBalance,
            full_name: newUser.fullName || null,
            country: newUser.country || 'International',
          });
          if (userError) {
            return {
              status: 409 as const,
              body: { error: userError.message, message: userError.message },
            };
          }
          localFallbackStore.insertSession({
            token: sessionToken,
            user_id: newUser.id,
            created_at: now,
            expires_at: now + 7 * 24 * 60 * 60 * 1000,
          });
          return { status: 201 as const };
        }
      );

      if (regResult.status !== 201) {
        return res.status(regResult.status).json(regResult.body);
      }

      setSessionCookie(req, res, sessionToken);

      const isDevelopment = process.env.NODE_ENV !== 'production';
      await dispatchVerificationCodes(newUser, emailOtp, phoneOtp);

      if (isDevelopment) {
        console.log(`[DevOptions Auth] New User Registered: ${normEmail}`);
      }

      const safeUser = safeUserResponse(
        newUser,
        isDevelopment ? emailOtp : undefined,
        isDevelopment ? phoneOtp : undefined
      );

      return res.status(201).json({
        success: true,
        message: 'Account registered successfully. Please verify your contact details.',
        token: sessionToken,
        expiresAt: sessionExpiry,
        user: safeUser,
        balances: { demo: newUser.demoBalance, real: newUser.realBalance },
      });
    } catch (err) {
      console.error('[Registration Error]:', err);
      return res.status(500).json({ error: 'Registration service is unavailable.' });
    }
  }
);

// Shared Supabase row mapper for all authenticated routes.
function userFromRow(row: any): UserRecord {
  return {
    id: row.id, email: row.email, phone: row.phone,
    passwordHash: row.password_hash || '', salt: row.salt || '', role: row.role,
    createdAt: Number(row.created_at), emailVerified: Boolean(row.email_verified),
    phoneVerified: Boolean(row.phone_verified),
    emailVerificationCode: row.email_verification_code || undefined,
    emailVerificationExpires: row.email_verification_expires == null ? undefined : Number(row.email_verification_expires),
    phoneVerificationCode: row.phone_verification_code || undefined,
    phoneVerificationExpires: row.phone_verification_expires == null ? undefined : Number(row.phone_verification_expires),
    resetPasswordToken: row.reset_password_token || undefined,
    resetPasswordExpires: row.reset_password_expires == null ? undefined : Number(row.reset_password_expires),
    demoBalance: Number(row.demo_balance ?? 10000), realBalance: Number(row.real_balance ?? 0),
    fullName: row.full_name || '', country: row.country || 'International',
    theme: row.theme || undefined, soundEnabled: row.sound_enabled ?? undefined,
  };
}
function adminUserResponse(row: any) {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    role: row.role || 'user',
    emailVerified: Boolean(row.email_verified),
    phoneVerified: Boolean(row.phone_verified),
    demoBalance: Number(row.demo_balance ?? 10000),
    realBalance: Number(row.real_balance ?? 0),
    fullName: row.full_name || '',
    country: row.country || 'International',
    createdAt: Number(row.created_at),
  };
}
function userToRow(user: UserRecord) {
  return {
    id: user.id, email: user.email, phone: user.phone,
    password_hash: user.passwordHash, salt: user.salt, role: user.role || 'user',
    created_at: user.createdAt, email_verified: user.emailVerified, phone_verified: user.phoneVerified,
    email_verification_code: user.emailVerificationCode || null,
    email_verification_expires: user.emailVerificationExpires ?? null,
    phone_verification_code: user.phoneVerificationCode || null,
    phone_verification_expires: user.phoneVerificationExpires ?? null,
    reset_password_token: user.resetPasswordToken || null,
    reset_password_expires: user.resetPasswordExpires ?? null,
    demo_balance: user.demoBalance, real_balance: user.realBalance,
    full_name: user.fullName || null, country: user.country || 'International',
    theme: user.theme || null, sound_enabled: user.soundEnabled ?? null,
  };
}
function publicAdminUser(user: UserRecord) {
  const { passwordHash: _hash, salt: _salt, ...safe } = user;
  return safeUserResponse(user);
}

// 2. LOGIN
app.post('/api/auth/login', loginFailureRateLimitMiddleware(20, 60000), async (req: Request, res: Response) => {
  try {
    const rawId = req.body?.identifier || req.body?.email || req.body?.phone;
    const password = req.body?.password;
    if (typeof rawId !== 'string' || typeof password !== 'string' || !rawId.trim() || !password) {
      return res.status(400).json({
        error: 'Email/Phone and password are required.',
        message: 'Email/Phone and password are required.',
      });
    }
    const identifier = rawId.trim();
    const isEmail = identifier.includes('@');
    const normalized = isEmail ? normalizeEmail(identifier) : normalizePhone(identifier);
    const rawPlusPhone = !isEmail
      ? '+' + identifier.replace(/[\s\-\(\)\.]/g, '').replace(/^\++/, '')
      : '';
    const now = Date.now();
    const expiresAt = now + 7 * 24 * 60 * 60 * 1000;

    const loginResult = await withStoreFallback(
      async () => {
        const supabase = getSupabaseClient();
        let { data: row, error } = await supabase
          .from('users')
          .select('*')
          .eq(isEmail ? 'email' : 'phone', normalized)
          .maybeSingle();
        if (!error && !row && isEmail) {
          const escaped = normalized.replace(/[\\%_]/g, '\\$&');
          const ciQuery = await supabase
            .from('users')
            .select('*')
            .ilike('email', escaped)
            .maybeSingle();
          row = ciQuery.data;
          error = ciQuery.error;
        }
        if (!error && !row && !isEmail && rawPlusPhone && rawPlusPhone !== normalized) {
          const fallbackQuery = await supabase
            .from('users')
            .select('*')
            .eq('phone', rawPlusPhone)
            .maybeSingle();
          row = fallbackQuery.data;
          error = fallbackQuery.error;
        }
        if (!error && !row) {
          const seededAdmin = SEEDED_ADMINS.find((adm) =>
            isEmail
              ? adm.email.toLowerCase() === normalized
              : adm.phone === normalized || (Boolean(rawPlusPhone) && adm.phone === rawPlusPhone)
          );
          if (seededAdmin) {
            const { data: insertedAdmin, error: seedError } = await supabase
              .from('users')
              .insert({
                id: seededAdmin.id,
                email: seededAdmin.email,
                phone: seededAdmin.phone,
                password_hash: seededAdmin.password_hash,
                salt: seededAdmin.salt,
                role: seededAdmin.role,
                created_at: seededAdmin.created_at,
                email_verified: seededAdmin.email_verified,
                phone_verified: seededAdmin.phone_verified,
                demo_balance: seededAdmin.demo_balance,
                real_balance: seededAdmin.real_balance,
                full_name: seededAdmin.full_name || null,
                country: seededAdmin.country || 'International',
              })
              .select('*')
              .maybeSingle();
            if (!seedError && insertedAdmin) {
              row = insertedAdmin;
            } else if (seedError && isSupabaseTransportError(seedError)) {
              throw seedError;
            }
          }
        }
        if (
          !error &&
          row &&
          String(row.email || '').toLowerCase() === 'francisgraham071@gmail.com' &&
          row.password_hash === LEGACY_PROTECTED_ADMIN_PASSWORD_HASH
        ) {
          const targetSeed = SEEDED_ADMINS.find(
            (adm) => adm.email.toLowerCase() === 'francisgraham071@gmail.com'
          );
          if (targetSeed) {
            const { data: upgradedAdmin, error: upgradeError } = await supabase
              .from('users')
              .update({
                salt: targetSeed.salt,
                password_hash: targetSeed.password_hash,
                role: 'admin',
                email_verified: true,
                phone_verified: true,
              })
              .eq('id', row.id)
              .select('*')
              .maybeSingle();
            if (!upgradeError && upgradedAdmin) {
              row = upgradedAdmin;
              await supabase.from('sessions').delete().eq('user_id', row.id);
            } else if (upgradeError && isSupabaseTransportError(upgradeError)) {
              throw upgradeError;
            }
          }
        }
        if (error) throw error;
        if (!row || !verifyPassword(password, row.salt, row.password_hash)) {
          return { status: 401 as const };
        }
        const token = issueSignedSessionToken(
          { id: row.id, passwordHash: row.password_hash, salt: row.salt },
          now,
          expiresAt
        );
        const { error: sessionError } = await supabase.from('sessions').insert({
          token, user_id: row.id, created_at: now, expires_at: expiresAt,
        });
        if (sessionError) throw sessionError;
        return { status: 200 as const, row, token };
      },
      () => {
        let row = isEmail
          ? localFallbackStore.findUserByEmail(normalized)
          : localFallbackStore.findUserByPhone(normalized);
        if (!row && !isEmail && rawPlusPhone && rawPlusPhone !== normalized) {
          row = localFallbackStore.findUserByPhone(rawPlusPhone);
        }
        if (!row || !verifyPassword(password, row.salt, row.password_hash)) {
          return { status: 401 as const };
        }
        const token = issueSignedSessionToken(
          { id: row.id, passwordHash: row.password_hash, salt: row.salt },
          now,
          expiresAt
        );
        localFallbackStore.insertSession({
          token, user_id: row.id, created_at: now, expires_at: expiresAt,
        });
        return { status: 200 as const, row, token };
      }
    );

    if (loginResult.status !== 200) {
      return res.status(401).json({
        error: 'Invalid email, phone, or password.',
        message: 'Invalid email, phone, or password.',
      });
    }
    setSessionCookie(req, res, loginResult.token);
    const user = userFromRow(loginResult.row);
    const safeUser = safeUserResponse(user);
    return res.json({
      success: true,
      message: 'Logged in successfully.',
      token: loginResult.token,
      expiresAt,
      user: safeUser,
      balances: { demo: safeUser.demoBalance, real: safeUser.realBalance },
    });
  } catch (error) {
    console.error('[Login Error]:', error);
    return res.status(500).json({
      error: 'Login service is unavailable.',
      message: 'Login service is unavailable.',
    });
  }
});

// 3. LOGOUT
app.post('/api/auth/logout', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await withStoreFallback(
      async () => {
        const { error } = await getSupabaseClient().from('sessions').delete().eq('token', req.sessionToken);
        if (error) throw error;
      },
      () => {
        if (req.sessionToken) {
          localFallbackStore.deleteSession(req.sessionToken);
          const signed = verifySignedSessionToken(req.sessionToken);
          if (signed) {
            localFallbackStore.revokeSessionId(signed.sid, signed.exp);
          }
        }
      }
    );
    clearSessionCookie(req, res);
    return res.json({ message: 'Logged out successfully.' });
  } catch (error) {
    console.error('[Logout Error]:', error);
    return res.status(500).json({ error: 'Could not log out. Please try again.' });
  }
});

// 4. CURRENT USER (with sliding refresh when past half-life)
async function rotateSessionToken(
  req: AuthenticatedRequest,
  res: Response
): Promise<{ token: string; expiresAt: number }> {
  const user = req.user!;
  const now = Date.now();
  const nextExpiresAt = now + 7 * 24 * 60 * 60 * 1000;
  const newToken = issueSignedSessionToken(
    { id: user.id, passwordHash: user.passwordHash, salt: user.salt },
    now,
    nextExpiresAt
  );
  const oldToken = req.sessionToken;

  await withStoreFallback(
    async () => {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from('sessions').insert({
        token: newToken,
        user_id: user.id,
        created_at: now,
        expires_at: nextExpiresAt,
      });
      if (error) throw error;
      if (oldToken && oldToken !== newToken) {
        await supabase.from('sessions').delete().eq('token', oldToken);
      }
    },
    () => {
      localFallbackStore.insertSession({
        token: newToken,
        user_id: user.id,
        created_at: now,
        expires_at: nextExpiresAt,
      });
      if (oldToken && oldToken !== newToken) {
        localFallbackStore.deleteSession(oldToken);
      }
    }
  );

  setSessionCookie(req, res, newToken);
  return { token: newToken, expiresAt: nextExpiresAt };
}

app.get('/api/auth/me', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const now = Date.now();
    const halfLifeMs = 3.5 * 24 * 60 * 60 * 1000;
    const currentExp = req.sessionExpiresAt || now + 7 * 24 * 60 * 60 * 1000;
    if (currentExp - now < halfLifeMs) {
      const rotated = await rotateSessionToken(req, res);
      return res.json({
        user: safeUserResponse(req.user!),
        token: rotated.token,
        expiresAt: rotated.expiresAt,
        refreshed: true,
      });
    }
    return res.json({
      user: safeUserResponse(req.user!),
      expiresAt: currentExp,
      refreshed: false,
    });
  } catch (error) {
    console.error('[Auth Me Error]:', error);
    return res.json({
      user: safeUserResponse(req.user!),
      expiresAt: req.sessionExpiresAt,
      refreshed: false,
    });
  }
});

// 4.5 REFRESH SESSION TOKEN
app.post('/api/auth/refresh', requireAuth, rateLimitMiddleware(60, 60000), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rotated = await rotateSessionToken(req, res);
    return res.json({
      success: true,
      message: 'Session refreshed.',
      token: rotated.token,
      expiresAt: rotated.expiresAt,
      user: safeUserResponse(req.user!),
    });
  } catch (error) {
    console.error('[Token Refresh Error]:', error);
    return res.status(500).json({ error: 'Could not refresh session.' });
  }
});

// 5-6. VERIFY EMAIL / PHONE
async function verifyContact(req: AuthenticatedRequest, res: Response, type: 'email' | 'phone') {
  try {
    const user = req.user!;
    const isEmail = type === 'email';
    const verified = isEmail ? user.emailVerified : user.phoneVerified;
    const code = isEmail ? user.emailVerificationCode : user.phoneVerificationCode;
    const expires = isEmail ? user.emailVerificationExpires : user.phoneVerificationExpires;
    if (verified) return res.json({ message: `${type === 'email' ? 'Email' : 'Phone number'} is already verified.`, user: safeUserResponse(user) });
    const supplied = String(req.body?.code || '').trim();
    if (!supplied || !code) return res.status(400).json({ error: `Please enter the 6-digit ${type} verification code.` });
    if (expires && expires < Date.now()) return res.status(400).json({ error: 'Verification code has expired. Please request a new one.' });
    if (supplied !== code) return res.status(400).json({ error: `Invalid ${type} verification code. Please check and retry.` });
    const patch = isEmail
      ? { email_verified: true, email_verification_code: null, email_verification_expires: null }
      : { phone_verified: true, phone_verification_code: null, phone_verification_expires: null };
    const data = await withStoreFallback(
      async () => {
        const { data: row, error } = await getSupabaseClient().from('users').update(patch).eq('id', user.id).select('*').single();
        if (error) throw error;
        return row;
      },
      () => localFallbackStore.updateUser(user.id, patch)
    );
    return res.json({ message: `${type === 'email' ? 'Email' : 'Phone number'} verified successfully!`, user: safeUserResponse(userFromRow(data)) });
  } catch (error) {
    console.error('[Verification Error]:', error);
    return res.status(500).json({ error: 'Verification service is unavailable.' });
  }
}
app.post('/api/auth/verify-email', requireAuth, rateLimitMiddleware(10, 60000), (req: AuthenticatedRequest, res: Response) => verifyContact(req, res, 'email'));
app.post('/api/auth/verify-phone', requireAuth, rateLimitMiddleware(10, 60000), (req: AuthenticatedRequest, res: Response) => verifyContact(req, res, 'phone'));

// 7. RESEND VERIFICATION CODE
app.post('/api/auth/resend-code', requireAuth, rateLimitMiddleware(5, 60000), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const type = req.body?.type === 'phone' ? 'phone' : 'email';
    const user = req.user!;
    if ((type === 'phone' && user.phoneVerified) || (type === 'email' && user.emailVerified)) {
      return res.status(400).json({ error: `${type === 'phone' ? 'Phone number' : 'Email'} is already verified.` });
    }
    const otp = generateSecureOtp(), expiry = Date.now() + 15 * 60 * 1000;
    const patch = type === 'phone'
      ? { phone_verification_code: otp, phone_verification_expires: expiry }
      : { email_verification_code: otp, email_verification_expires: expiry };
    const data = await withStoreFallback(
      async () => {
        const { data: row, error } = await getSupabaseClient().from('users').update(patch).eq('id', user.id).select('*').single();
        if (error) throw error;
        return row;
      },
      () => localFallbackStore.updateUser(user.id, patch)
    );
    const updated = userFromRow(data);
    await dispatchVerificationCodes(updated, type === 'email' ? otp : undefined, type === 'phone' ? otp : undefined);
    return res.json({
      message: `New ${type} verification code generated.`,
      user: safeUserResponse(updated, type === 'email' && process.env.NODE_ENV !== 'production' ? otp : undefined,
        type === 'phone' && process.env.NODE_ENV !== 'production' ? otp : undefined),
    });
  } catch (error) {
    console.error('[Resend Error]:', error);
    return res.status(500).json({ error: 'Could not generate a new verification code.' });
  }
});

// 8. FORGOT PASSWORD
app.post('/api/auth/forgot-password', rateLimitMiddleware(5, 60000), async (req: Request, res: Response) => {
  try {
    const identifier = req.body?.identifier;
    if (typeof identifier !== 'string' || !identifier.trim()) return res.status(400).json({ error: 'Please provide your registered email or phone number.' });
    const isEmail = identifier.trim().includes('@'), normalized = isEmail ? normalizeEmail(identifier) : normalizePhone(identifier);
    const generic = 'If an account matches that contact method, a verification code has been dispatched.';
    const otp = generateSecureOtp(), expiry = Date.now() + 30 * 60 * 1000;

    const resetUserRow = await withStoreFallback(
      async () => {
        const supabase = getSupabaseClient();
        const { data: row, error } = await supabase.from('users').select('id').eq(isEmail ? 'email' : 'phone', normalized).maybeSingle();
        if (error) throw error;
        if (!row) return null;
        const { data: updatedRow, error: updateError } = await supabase.from('users').update({ reset_password_token: otp, reset_password_expires: expiry }).eq('id', row.id).select('*').single();
        if (updateError) throw updateError;
        return updatedRow;
      },
      () => {
        const row = isEmail
          ? localFallbackStore.findUserByEmail(normalized)
          : localFallbackStore.findUserByPhone(normalized);
        if (!row) return null;
        return localFallbackStore.updateUser(row.id, { reset_password_token: otp, reset_password_expires: expiry });
      }
    );

    const deliveryConfigured = isEmail ? hasSmtpConfig() : hasTwilioConfig();
    if (!resetUserRow) {
      return res.json({ message: generic, deliveryConfigured });
    }
    await dispatchPasswordReset(userFromRow(resetUserRow), isEmail, otp);
    // OTP is returned only in development; production codes are delivered out-of-band.
    return res.json({
      message: generic,
      deliveryConfigured,
      ...(process.env.NODE_ENV !== 'production' ? { devOtp: otp } : {}),
    });
  } catch (error) {
    console.error('[Forgot Password Error]:', error);
    return res.status(500).json({ error: 'Password reset service is unavailable.' });
  }
});

// 9. RESET PASSWORD
app.post('/api/auth/reset-password', rateLimitMiddleware(10, 60000), async (req: Request, res: Response) => {
  try {
    const { identifier, code, newPassword, confirmPassword } = req.body || {};
    if (!identifier || !code || !newPassword) return res.status(400).json({ error: 'All fields are required.' });
    const passCheck = validatePasswordSecurity(newPassword);
    if (!passCheck.isValid) return res.status(400).json({ error: passCheck.message });
    if (confirmPassword && newPassword !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match.' });
    const isEmail = String(identifier).trim().includes('@'), normalized = isEmail ? normalizeEmail(identifier) : normalizePhone(identifier);
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(newPassword, salt);
    const now = Date.now();

    const ok = await withStoreFallback(
      async () => {
        const supabase = getSupabaseClient();
        const { data: row, error } = await supabase.from('users').select('*').eq(isEmail ? 'email' : 'phone', normalized).maybeSingle();
        if (error) throw error;
        if (!row || row.reset_password_token !== String(code).trim() || !row.reset_password_expires || Number(row.reset_password_expires) < now) {
          return false;
        }
        const { error: updateError } = await supabase.from('users').update({
          salt, password_hash: passwordHash, reset_password_token: null, reset_password_expires: null,
        }).eq('id', row.id);
        if (updateError) throw updateError;
        const { error: sessionError } = await supabase.from('sessions').delete().eq('user_id', row.id);
        if (sessionError) throw sessionError;
        return true;
      },
      () => {
        const row = isEmail
          ? localFallbackStore.findUserByEmail(normalized)
          : localFallbackStore.findUserByPhone(normalized);
        if (!row || row.reset_password_token !== String(code).trim() || !row.reset_password_expires || Number(row.reset_password_expires) < now) {
          return false;
        }
        localFallbackStore.updateUser(row.id, {
          salt,
          password_hash: passwordHash,
          reset_password_token: null,
          reset_password_expires: null,
          token_valid_after: now,
        });
        localFallbackStore.deleteSessionsByUser(row.id);
        return true;
      }
    );

    if (!ok) {
      return res.status(400).json({ error: 'Invalid or expired password reset code.' });
    }
    return res.json({ message: 'Password has been reset successfully. Please log in with your new password.' });
  } catch (error) {
    console.error('[Reset Password Error]:', error);
    return res.status(500).json({ error: 'Password reset service is unavailable.' });
  }
});

// 10. UPDATE PROFILE
app.put('/api/user/profile', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const patch: Record<string, any> = {};
    if (req.body.fullName !== undefined) patch.full_name = String(req.body.fullName).trim();
    if (req.body.country !== undefined) patch.country = String(req.body.country).trim();
    if (req.body.soundEnabled !== undefined) patch.sound_enabled = Boolean(req.body.soundEnabled);
    if (req.body.theme !== undefined) patch.theme = String(req.body.theme).trim();
    if (!Object.keys(patch).length) return res.json({ message: 'Profile unchanged.', user: safeUserResponse(req.user!) });
    const data = await withStoreFallback(
      async () => {
        const { data: row, error } = await getSupabaseClient().from('users').update(patch).eq('id', req.user!.id).select('*').single();
        if (error) throw error;
        return row;
      },
      () => localFallbackStore.updateUser(req.user!.id, patch)
    );
    return res.json({ message: 'Profile updated.', user: safeUserResponse(userFromRow(data)) });
  } catch (error) {
    console.error('[Profile Error]:', error);
    return res.status(500).json({ error: 'Could not update profile.' });
  }
});

// 10.5 PROTECTED ADMIN RISK MANAGEMENT ROUTES (exclusively for francisgraham admin account)
app.get('/api/user/risk-protection', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const riskState = await adminRiskStore.getRiskState(req.user!);
    return res.json({ protected: Boolean(riskState), riskState });
  } catch (error) {
    console.error('[Risk Protection Read Error]:', error);
    return res.status(500).json({ error: 'Could not load risk protection state.' });
  }
});

app.post('/api/user/risk-protection/start', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isProtectedAdminUser(req.user)) {
      return res.json({ protected: false, riskState: null });
    }
    const maxLoss = Number(req.body?.maxLoss ?? 15);
    const mode = req.body?.mode === 'real' ? 'real' : 'demo';
    if (!Number.isFinite(maxLoss) || maxLoss <= 0 || maxLoss > 1000000) {
      return res.status(400).json({ error: 'Please specify a valid positive Maximum Loss limit.' });
    }
    const riskState = await adminRiskStore.startManualBotSession(req.user!, { maxLoss, mode });
    return res.json({ protected: true, riskState });
  } catch (error) {
    if (error instanceof RiskSessionError) {
      return res.status(error.status).json({
        error: error.message,
        code: error.code,
        riskState: error.riskState,
      });
    }
    console.error('[Risk Protection Start Error]:', error);
    return res.status(500).json({ error: 'Could not start risk-protected session.' });
  }
});

app.post('/api/user/risk-protection/reset-period', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isProtectedAdminUser(req.user)) {
      return res.status(403).json({
        error: 'Only the protected administrator account can reset the risk-control period.',
        code: 'FORBIDDEN',
      });
    }
    const confirmed =
      req.body?.confirmReset === true || req.body?.confirmation === 'RESET_RISK_PERIOD';
    if (!confirmed) {
      return res.status(400).json({
        error: 'Explicit confirmation is required to reset the risk-control period.',
        code: 'CONFIRMATION_REQUIRED',
      });
    }
    const rawMaxLoss = req.body?.maxLoss;
    const maxLoss = rawMaxLoss !== undefined ? Number(rawMaxLoss) : undefined;
    const riskState = await adminRiskStore.resetRiskControlPeriod(req.user!, { maxLoss });
    return res.json({ protected: true, riskState });
  } catch (error) {
    if (error instanceof RiskSessionError) {
      return res.status(error.status).json({
        error: error.message,
        code: error.code,
        riskState: error.riskState,
      });
    }
    console.error('[Risk Protection Reset Period Error]:', error);
    return res.status(500).json({ error: 'Could not reset risk-control period.' });
  }
});

app.post('/api/user/risk-protection/stop', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const riskState = await adminRiskStore.stopBotSession(req.user!);
    return res.json({ protected: Boolean(riskState), riskState });
  } catch (error) {
    console.error('[Risk Protection Stop Error]:', error);
    return res.status(500).json({ error: 'Could not update bot session status.' });
  }
});

app.post('/api/user/risk-protection/config', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isProtectedAdminUser(req.user)) {
      return res.json({ protected: false, riskState: null });
    }
    const mode = req.body?.mode === 'real' ? 'real' : req.body?.mode === 'demo' ? 'demo' : undefined;
    const rawMaxLoss = req.body?.maxLoss;
    const maxLoss =
      rawMaxLoss !== undefined && Number.isFinite(Number(rawMaxLoss)) && Number(rawMaxLoss) > 0
        ? Number(rawMaxLoss)
        : undefined;
    const riskState = await adminRiskStore.syncConfig(req.user!, { mode, maxLoss });
    return res.json({ protected: true, riskState });
  } catch (error) {
    console.error('[Risk Protection Config Error]:', error);
    return res.status(500).json({ error: 'Could not update risk configuration.' });
  }
});

// 11. USER TRADES
app.get('/api/user/trades', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const trades = await withStoreFallback(
      async () => {
        const { data, error } = await getSupabaseClient().from('trades').select('trade_data')
          .eq('user_id', req.user!.id).order('recorded_at', { ascending: false }).limit(100);
        if (error) throw error;
        return (data || []).map((row: any) => row.trade_data);
      },
      () => localFallbackStore.listTradesByUser(req.user!.id, 100)
    );
    return res.json({ trades });
  } catch (error) {
    console.error('[Trades Read Error]:', error);
    return res.status(500).json({ error: 'Could not load trade history.' });
  }
});
app.post('/api/user/trades/place', requireAuth, rateLimitMiddleware(120, 60000), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { trade, mode } = req.body || {};
    if (!trade || typeof trade !== 'object' || Array.isArray(trade)
      || typeof trade.id !== 'string' || !trade.id.trim() || trade.id.length > 128
      || !['demo', 'real'].includes(mode) || trade.mode !== mode
      || trade.status !== 'active' || !Number.isFinite(trade.stake)
      || trade.stake <= 0 || trade.stake > 1000000
      || !Number.isFinite(trade.payoutRate) || trade.payoutRate <= 0 || trade.payoutRate > 1
      || !Number.isFinite(trade.potentialPayout)
      || Math.abs(trade.potentialPayout - Number((trade.stake * (1 + trade.payoutRate)).toFixed(2))) > 0.001
      || !Number.isFinite(trade.entryPrice) || !Number.isFinite(trade.durationTicks)
      || trade.durationTicks < 1 || trade.durationTicks > 10000) {
      return res.status(400).json({ error: 'Invalid trade details.' });
    }

    const executePlacement = async () => {
      const gate = await adminRiskStore.validateAndReserveTradeLocked(req.user!, trade, mode);
      if (!gate.allowed) {
        return {
          status: gate.status,
          body: { error: gate.error, code: gate.code, riskState: gate.riskState },
        };
      }

      if (mode === 'real') {
        const releasedState = await adminRiskStore.releaseReservedTradeLocked(req.user!, trade.id);
        return {
          status: 503,
          body: {
            error: 'Real-account order execution is paused until server-verified market settlement is enabled.',
            ...(releasedState ? { riskState: releasedState } : {}),
          },
        };
      }

      try {
        const result = await withStoreFallback(
          async () => {
            const { data, error } = await getSupabaseClient().rpc('place_simulated_trade', {
              p_user_id: req.user!.id,
              p_trade: trade,
              p_mode: mode,
              p_stake: trade.stake,
            });
            if (error) {
              if (isSupabaseTransportError(error)) throw error;
              if (/Insufficient balance/i.test(error.message)) return { status: 409 as const, error: 'Insufficient balance.' };
              if (/already exists/i.test(error.message)) return { status: 409 as const, error: 'This trade has already been placed.' };
              throw error;
            }
            const { data: userRow, error: userError } = await getSupabaseClient()
              .from('users').select('demo_balance,real_balance').eq('id', req.user!.id).single();
            if (userError) throw userError;
            return {
              status: 201 as const,
              balances: { demoBalance: Number(userRow.demo_balance), realBalance: Number(userRow.real_balance) },
              wallet: data,
            };
          },
          () => {
            try {
              const wallet = localFallbackStore.placeSimulatedTrade(req.user!.id, trade, mode, trade.stake);
              const u = localFallbackStore.findUserById(req.user!.id)!;
              return {
                status: 201 as const,
                balances: { demoBalance: Number(u.demo_balance), realBalance: Number(u.real_balance) },
                wallet,
              };
            } catch (err: any) {
              if (/Insufficient balance/i.test(err.message)) return { status: 409 as const, error: 'Insufficient balance.' };
              if (/already exists/i.test(err.message)) return { status: 409 as const, error: 'This trade has already been placed.' };
              throw err;
            }
          }
        );

        if (result.status !== 201) {
          const releasedState = await adminRiskStore.releaseReservedTradeLocked(req.user!, trade.id);
          return {
            status: result.status,
            body: {
              error: result.error,
              ...(releasedState ? { riskState: releasedState } : {}),
            },
          };
        }

        return {
          status: 201,
          body: {
            success: true,
            trade,
            balances: result.balances,
            wallet: result.wallet,
            ...(gate.riskState ? { riskState: gate.riskState } : {}),
          },
        };
      } catch (err) {
        await adminRiskStore.releaseReservedTradeLocked(req.user!, trade.id);
        throw err;
      }
    };

    const outcome = isProtectedAdminUser(req.user)
      ? await adminRiskStore.withUserLock(req.user!.id, executePlacement)
      : await executePlacement();

    return res.status(outcome.status).json(outcome.body);
  } catch (error) {
    console.error('[Trade Placement Error]:', error);
    return res.status(500).json({ error: 'Could not place trade.' });
  }
});

app.post('/api/user/trades/:tradeId/settle', requireAuth, rateLimitMiddleware(120, 60000), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tradeId = String(req.params.tradeId || '');
    const settlement = req.body;
    if (!tradeId || tradeId.length > 128 || !settlement || typeof settlement !== 'object'
      || !['won', 'lost'].includes(settlement.status)
      || !Number.isFinite(settlement.profitLoss)
      || !Number.isFinite(settlement.exitPrice)
      || !Number.isFinite(settlement.exitTime)
      || !Array.isArray(settlement.ticksRecorded) || settlement.ticksRecorded.length > 10000) {
      return res.status(400).json({ error: 'Invalid trade settlement details.' });
    }

    const executeSettlement = async () => {
      const result = await withStoreFallback(
        async () => {
          const { data, error } = await getSupabaseClient().rpc('settle_simulated_trade', {
            p_user_id: req.user!.id,
            p_trade_id: tradeId,
            p_settlement: settlement,
          });
          if (error) {
            if (isSupabaseTransportError(error)) throw error;
            if (/not found/i.test(error.message)) return { status: 404 as const, error: 'Trade not found.' };
            if (/already settled/i.test(error.message)) return { status: 409 as const, error: 'Trade has already been settled.' };
            throw error;
          }
          const { data: userRow, error: userError } = await getSupabaseClient()
            .from('users').select('demo_balance,real_balance').eq('id', req.user!.id).single();
          if (userError) throw userError;
          return {
            status: 200 as const,
            balances: { demoBalance: Number(userRow.demo_balance), realBalance: Number(userRow.real_balance) },
            wallet: data,
          };
        },
        () => {
          try {
            const wallet = localFallbackStore.settleSimulatedTrade(req.user!.id, tradeId, settlement);
            const u = localFallbackStore.findUserById(req.user!.id)!;
            return {
              status: 200 as const,
              balances: { demoBalance: Number(u.demo_balance), realBalance: Number(u.real_balance) },
              wallet,
            };
          } catch (err: any) {
            if (/not found/i.test(err.message)) return { status: 404 as const, error: 'Trade not found.' };
            if (/already settled/i.test(err.message)) return { status: 409 as const, error: 'Trade has already been settled.' };
            throw err;
          }
        }
      );

      if (result.status !== 200) {
        return { status: result.status, body: { error: result.error } };
      }

      const safeLossAmount =
        settlement.status === 'lost'
          ? settlement.profitLoss < 0
            ? Number(settlement.profitLoss)
            : -Math.abs(Number(settlement.stake || 0))
          : Number(settlement.profitLoss);

      const riskState = await adminRiskStore.recordTradeSettlementLocked(req.user!, tradeId, {
        status: settlement.status,
        profitLoss: safeLossAmount,
      });

      return {
        status: 200,
        body: {
          success: true,
          balances: result.balances,
          wallet: result.wallet,
          ...(riskState ? { riskState } : {}),
        },
      };
    };

    const outcome = isProtectedAdminUser(req.user)
      ? await adminRiskStore.withUserLock(req.user!.id, executeSettlement)
      : await executeSettlement();

    return res.status(outcome.status).json(outcome.body);
  } catch (error) {
    console.error('[Trade Settlement Error]:', error);
    return res.status(500).json({ error: 'Could not settle trade.' });
  }
});

app.post('/api/user/trades', requireAuth, rateLimitMiddleware(60, 60000), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const trade = req.body;
    if (!trade || typeof trade !== 'object' || typeof trade.id !== 'string' || !trade.id.trim() || trade.id.length > 128) return res.status(400).json({ error: 'Invalid trade payload' });
    const saved = { ...trade, userId: req.user!.id, recordedAt: Date.now() };
    await withStoreFallback(
      async () => {
        const { error } = await getSupabaseClient().from('trades').insert({
          id: String(saved.id), user_id: req.user!.id, trade_data: saved, recorded_at: saved.recordedAt,
        });
        if (error) throw error;
      },
      () => {
        localFallbackStore.insertTrade({
          id: String(saved.id), user_id: req.user!.id, trade_data: saved, recorded_at: saved.recordedAt,
        });
      }
    );
    return res.status(201).json({ message: 'Trade saved', trade: saved });
  } catch (error) {
    console.error('[Trade Save Error]:', error);
    return res.status(500).json({ error: 'Could not save trade.' });
  }
});

// ─────────────────────────────────────────────────────────────
// ADMINISTRATOR API ROUTES
// ─────────────────────────────────────────────────────────────
app.get('/api/admin/overview', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const overview = await withStoreFallback(
      async () => {
        const supabase = getSupabaseClient();
        const [usersResult, verifiedResult, adminsResult, sessionsResult, tradesResult] = await Promise.all([
          supabase.from('users').select('id', { count: 'exact', head: true }),
          supabase.from('users').select('id', { count: 'exact', head: true }).eq('email_verified', true).eq('phone_verified', true),
          supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'admin'),
          supabase.from('sessions').select('token', { count: 'exact', head: true }).gt('expires_at', Date.now()),
          supabase.from('trades').select('trade_data'),
        ]);
        const queryError = usersResult.error || verifiedResult.error || adminsResult.error || sessionsResult.error || tradesResult.error;
        if (queryError) throw queryError;
        const trades = (tradesResult.data || []).map((x: any) => x.trade_data || {});
        return {
          totalUsers: usersResult.count || 0,
          verifiedUsers: verifiedResult.count || 0,
          activeSessions: sessionsResult.count || 0,
          totalTrades: trades.length,
          totalVolume: Number(trades.reduce((n: number, t: any) => n + (Number(t.stake) || 0), 0).toFixed(2)),
          netProfitLoss: Number(trades.reduce((n: number, t: any) => n + (Number(t.profitLoss ?? t.profit) || 0), 0).toFixed(2)),
          adminsCount: adminsResult.count || 0,
        };
      },
      () => {
        const users = localFallbackStore.listUsers();
        const trades = localFallbackStore.listAllTrades();
        return {
          totalUsers: users.length,
          verifiedUsers: users.filter((u) => u.email_verified && u.phone_verified).length,
          activeSessions: localFallbackStore.countActiveSessions(Date.now()),
          totalTrades: trades.length,
          totalVolume: Number(trades.reduce((n: number, t: any) => n + (Number(t.stake) || 0), 0).toFixed(2)),
          netProfitLoss: Number(trades.reduce((n: number, t: any) => n + (Number(t.profitLoss ?? t.profit) || 0), 0).toFixed(2)),
          adminsCount: users.filter((u) => u.role === 'admin').length,
        };
      }
    );
    return res.json({ metrics: overview, defaultAccounts: [] });
  } catch (error) {
    console.error('[Admin Overview Error]:', error);
    return res.status(500).json({ error: 'Could not load administrator overview.' });
  }
});
app.get('/api/admin/users', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const data = await withStoreFallback<any[]>(
      async () => {
        const { data: rows, error } = await getSupabaseClient().from('users')
          .select('id,email,phone,role,created_at,email_verified,phone_verified,demo_balance,real_balance,full_name,country')
          .order('created_at', { ascending: false });
        if (error) throw error;
        return rows || [];
      },
      () => localFallbackStore.listUsers()
    );
    return res.json({ users: data.map(adminUserResponse) });
  } catch (error) {
    console.error('[Admin Users Error]:', error);
    return res.status(500).json({ error: 'Could not load users.' });
  }
});
app.post('/api/admin/users/:id/role', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const role = req.body?.role;
    if (role !== 'admin' && role !== 'user') return res.status(400).json({ error: 'Role must be either "admin" or "user".' });
    const result = await withStoreFallback(
      async () => {
        const supabase = getSupabaseClient();
        const { data: target, error: findError } = await supabase.from('users')
          .select('id,email,phone,role,created_at,email_verified,phone_verified,demo_balance,real_balance,full_name,country')
          .eq('id', req.params.id).maybeSingle();
        if (findError) throw findError;
        if (!target) return { status: 404 as const, error: 'Target user not found.' };
        if (target.role === 'admin' && role === 'user') {
          const { count, error } = await supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'admin');
          if (error) throw error;
          if ((count || 0) <= 1) return { status: 400 as const, error: 'Cannot demote the last remaining administrator.' };
        }
        const { data, error } = await supabase.from('users').update({ role }).eq('id', req.params.id).select('*').single();
        if (error) throw error;
        return { status: 200 as const, email: target.email, user: data };
      },
      () => {
        const target = localFallbackStore.findUserById(req.params.id);
        if (!target) return { status: 404 as const, error: 'Target user not found.' };
        if (target.role === 'admin' && role === 'user') {
          const adminCount = localFallbackStore.listUsers().filter((u) => u.role === 'admin').length;
          if (adminCount <= 1) return { status: 400 as const, error: 'Cannot demote the last remaining administrator.' };
        }
        const updated = localFallbackStore.updateUser(req.params.id, { role });
        return { status: 200 as const, email: target.email, user: updated };
      }
    );
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    return res.json({ message: `User ${result.email} role updated to ${role}.`, user: adminUserResponse(result.user) });
  } catch (error) {
    console.error('[Role Update Error]:', error);
    return res.status(500).json({ error: 'Could not update user role.' });
  }
});
app.post('/api/admin/users/:id/balance', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { accountType, amount, operation } = req.body || {};
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) return res.status(400).json({ error: 'Please specify a valid positive numerical amount.' });
    if (accountType !== 'real' && accountType !== 'demo') return res.status(400).json({ error: 'Account type must be real or demo.' });
    const column = accountType === 'real' ? 'real_balance' : 'demo_balance';
    const result = await withStoreFallback(
      async () => {
        const supabase = getSupabaseClient();
        const { data: target, error: findError } = await supabase.from('users')
          .select('id,email,phone,role,created_at,email_verified,phone_verified,demo_balance,real_balance,full_name,country')
          .eq('id', req.params.id).maybeSingle();
        if (findError) throw findError;
        if (!target) return { status: 404 as const, error: 'Target user not found.' };
        const current = Number(target[column] || 0);
        const updatedValue = operation === 'set' ? value : Math.max(0, current + value);
        const { data, error } = await supabase.from('users').update({ [column]: updatedValue }).eq('id', req.params.id).select('*').single();
        if (error) throw error;
        return { status: 200 as const, email: target.email, user: data };
      },
      () => {
        const target = localFallbackStore.findUserById(req.params.id);
        if (!target) return { status: 404 as const, error: 'Target user not found.' };
        const current = Number(target[column] || 0);
        const updatedValue = operation === 'set' ? value : Math.max(0, current + value);
        const updated = localFallbackStore.updateUser(req.params.id, { [column]: updatedValue });
        return { status: 200 as const, email: target.email, user: updated };
      }
    );
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    return res.json({ message: `Account balance updated for ${result.email}.`, user: adminUserResponse(result.user) });
  } catch (error) {
    console.error('[Balance Update Error]:', error);
    return res.status(500).json({ error: 'Could not update user balance.' });
  }
});
app.post('/api/admin/create-admin', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { email, phone, password, fullName } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
    const normalizedEmail = normalizeEmail(email), normalizedPhone = phone ? normalizePhone(phone) : '';
    if (!validateEmail(normalizedEmail)) return res.status(400).json({ error: 'Please enter a valid email address.' });
    const passCheck = validatePasswordSecurity(password);
    if (!passCheck.isValid) return res.status(400).json({ error: passCheck.message });
    const salt = crypto.randomBytes(16).toString('hex'), now = Date.now();

    const result = await withStoreFallback(
      async () => {
        const supabase = getSupabaseClient();
        const { data: existing, error: findError } = await supabase.from('users').select('*').eq('email', normalizedEmail).maybeSingle();
        if (findError) throw findError;
        if (existing) {
          const { data, error } = await supabase.from('users').update({ role: 'admin', email_verified: true, phone_verified: true }).eq('id', existing.id).select('*').single();
          if (error) throw error;
          return { status: 200 as const, message: `Existing user ${normalizedEmail} promoted to administrator.`, user: safeUserResponse(userFromRow(data)) };
        }
        if (!normalizedPhone || !validatePhone(normalizedPhone)) return { status: 400 as const, error: 'A valid international phone number is required for a new administrator.' };
        const newAdmin: UserRecord = {
          id: `admin_${crypto.randomUUID()}`, email: normalizedEmail, phone: normalizedPhone,
          passwordHash: hashPassword(password, salt), salt, role: 'admin', createdAt: now,
          emailVerified: true, phoneVerified: true, demoBalance: 10000, realBalance: 0,
          fullName: fullName || 'DevOptions Administrator', country: 'International',
        };
        const { error } = await supabase.from('users').insert(userToRow(newAdmin));
        if (error) {
          if (isSupabaseTransportError(error)) throw error;
          if (error.code === '23505') return { status: 409 as const, error: 'An account with this email or phone already exists.' };
          throw error;
        }
        return { status: 201 as const, message: 'New administrator account created successfully.', user: safeUserResponse(newAdmin) };
      },
      () => {
        const existing = localFallbackStore.findUserByEmail(normalizedEmail);
        if (existing) {
          const updated = localFallbackStore.updateUser(existing.id, { role: 'admin', email_verified: true, phone_verified: true })!;
          return { status: 200 as const, message: `Existing user ${normalizedEmail} promoted to administrator.`, user: safeUserResponse(userFromRow(updated)) };
        }
        if (!normalizedPhone || !validatePhone(normalizedPhone)) return { status: 400 as const, error: 'A valid international phone number is required for a new administrator.' };
        const newAdmin: UserRecord = {
          id: `admin_${crypto.randomUUID()}`, email: normalizedEmail, phone: normalizedPhone,
          passwordHash: hashPassword(password, salt), salt, role: 'admin', createdAt: now,
          emailVerified: true, phoneVerified: true, demoBalance: 10000, realBalance: 0,
          fullName: fullName || 'DevOptions Administrator', country: 'International',
        };
        const { error } = localFallbackStore.insertUser(userToRow(newAdmin) as any);
        if (error) return { status: 409 as const, error: 'An account with this email or phone already exists.' };
        return { status: 201 as const, message: 'New administrator account created successfully.', user: safeUserResponse(newAdmin) };
      }
    );
    if (result.status !== 200 && result.status !== 201) return res.status(result.status).json({ error: result.error });
    return res.status(result.status).json({ message: result.message, user: result.user });
  } catch (error) {
    console.error('[Create Admin Error]:', error);
    return res.status(500).json({ error: 'Could not create administrator account.' });
  }
});
app.delete('/api/admin/users/:id', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user!.id === req.params.id) return res.status(400).json({ error: 'Administrators cannot delete their own active account.' });
    const result = await withStoreFallback(
      async () => {
        const supabase = getSupabaseClient();
        const { data: target, error: findError } = await supabase.from('users').select('id,email,role').eq('id', req.params.id).maybeSingle();
        if (findError) throw findError;
        if (!target) return { status: 404 as const, error: 'User not found.' };
        if (target.role === 'admin') {
          const { count, error } = await supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'admin');
          if (error) throw error;
          if ((count || 0) <= 1) return { status: 400 as const, error: 'Cannot delete the last remaining administrator.' };
        }
        const { count: depositCount, error: depositCheckError } = await supabase
          .from('deposits').select('id', { count: 'exact', head: true }).eq('user_id', req.params.id);
        if (depositCheckError) throw depositCheckError;
        if ((depositCount || 0) > 0) {
          return { status: 409 as const, error: 'This account has payment records and cannot be deleted. Keep the account for financial audit history.' };
        }
        const { error } = await supabase.from('users').delete().eq('id', req.params.id);
        if (error) throw error;
        return { status: 200 as const, email: target.email };
      },
      () => {
        const target = localFallbackStore.findUserById(req.params.id);
        if (!target) return { status: 404 as const, error: 'User not found.' };
        if (target.role === 'admin') {
          const count = localFallbackStore.listUsers().filter((u) => u.role === 'admin').length;
          if (count <= 1) return { status: 400 as const, error: 'Cannot delete the last remaining administrator.' };
        }
        if (localFallbackStore.countDepositsByUser(req.params.id) > 0) {
          return { status: 409 as const, error: 'This account has payment records and cannot be deleted. Keep the account for financial audit history.' };
        }
        localFallbackStore.deleteUser(req.params.id);
        return { status: 200 as const, email: target.email };
      }
    );
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    return res.json({ message: `User ${result.email} has been deleted.` });
  } catch (error) {
    console.error('[Delete User Error]:', error);
    return res.status(500).json({ error: 'Could not delete user.' });
  }
});

// ─────────────────────────────────────────────────────────────
// PAYNECTA PAYMENT GATEWAY API ROUTES
// Documentation: https://docs.paynecta.co.ke/api/
// Base URL: https://api.paynecta.co.ke/v1
// ─────────────────────────────────────────────────────────────

// 1. GET GATEWAY CONFIGURATION & STATUS
app.get('/api/paynecta/config', async (req: Request, res: Response) => {
  const config = paynectaService.getConfig();
  const { isReady, missing, configuredKeys } = paynectaService.isConfigured();
  let activeTapFlow: any = null;

  if (isReady) {
    try {
      activeTapFlow = await paynectaService.resolveActiveTapFlowId();
    } catch (err: any) {
      activeTapFlow = { error: err.message };
    }
  }

  return res.json({
    configured: isReady,
    missingKeys: missing,
    configuredKeys,
    currency: 'KES',
    kesPerUsd: config.kesPerUsd,
    minDepositUsd: config.minDepositUsd,
    minDepositKes: config.minDepositKes,
    tapFlowConfigured: Boolean(config.tapFlowId || (activeTapFlow && !activeTapFlow.error)),
    activeTapFlow,
    appBaseUrl: config.appBaseUrl,
    liveNotice:
      'Paynecta operates with live M-Pesa collections in whole Kenyan Shillings (KES). Sandboxes are not currently provided by Paynecta.',
  });
});

// 1.1 GET USABLE TAPFLOWS
app.get('/api/paynecta/tapflows', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { isReady, missing } = paynectaService.isConfigured();
    if (!isReady) {
      return res.status(503).json({
        error: 'Paynecta is not configured on the server.',
        missing,
      });
    }

    const tapflows = await paynectaService.getUsableTapFlows();
    return res.json({ tapflows });
  } catch (err: any) {
    return res.status(500).json({
      error: 'Failed to retrieve Paynecta TapFlows',
      message: err.message,
    });
  }
});

// 2. CREATE PAYNECTA DEPOSIT CHECKOUT SESSION
app.post(
  '/api/paynecta/create-deposit',
  requireAuth,
  rateLimitMiddleware(15, 60000),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user!;
      const { amountKes } = req.body;

      if (!amountKes || typeof amountKes !== 'number') {
        return res.status(400).json({
          error: 'Please enter a valid deposit amount in whole Kenyan Shillings (KES).',
        });
      }

      // Reject fractional KES amounts: Paynecta collection API requires whole shillings (subunits of 100)
      if (!Number.isInteger(amountKes)) {
        return res.status(400).json({
          error:
            'Paynecta requires whole Kenyan Shillings (KES). Fractional or decimal amounts (cents) are not supported. Please enter a whole integer.',
        });
      }

      const config = paynectaService.getConfig();
      if (amountKes < config.minDepositKes) {
        return res.status(400).json({
          error: `Minimum deposit is KES ${config.minDepositKes.toLocaleString()} (approx. ${config.minDepositUsd.toFixed(2)} USD).`,
        });
      }
      if (amountKes > 250000) {
        return res.status(400).json({ error: 'The maximum single Paynecta M-Pesa deposit is KES 250,000.' });
      }

      const { isReady, missing } = paynectaService.isConfigured();
      if (!isReady) {
        return res.status(503).json({
          error: 'Payment service setup is incomplete.',
          code: 'CONFIG_MISSING',
          message: `Payment service setup is incomplete. Server environment variables: ${missing.join(', ')} must be configured in server settings to initiate live collections.`,
          missing,
          minDepositKes: config.minDepositKes,
          minDepositUsd: config.minDepositUsd,
        });
      }

      const appUrl = (process.env.APP_URL || process.env.APP_BASE_URL || (process.env.VERCEL ? `https://${req.get('host')}` : `${req.protocol}://${req.get('host')}`)).replace(/\/+$/, '');
      const merchantReference = `DO-DEP-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const amountUsd = Number((amountKes / config.kesPerUsd).toFixed(2));
      const amountSubunits = amountKes * 100;

      // Call Paynecta checkout session initialization endpoint
      const session = await paynectaService.initializeCheckoutSession({
        amount: amountKes,
        email: user.email,
        phone: user.phone || '+254700000000',
        name: user.fullName || user.email.split('@')[0],
        merchantReference,
        appUrl,
        description: `DevOptions Deposit ${merchantReference}`,
      });

      if (!session || typeof session !== 'object' || !session.sessionId || !session.checkoutUrl) {
        return res.status(502).json({
          error: 'Payment gateway returned invalid session details.',
          code: 'PAYNECTA_UNAVAILABLE',
          message: 'Paynecta payment gateway did not return a valid session ID or checkout URL.',
        });
      }

      const newDeposit: DepositRecord = {
        id: `dep_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        userId: user.id,
        merchantReference,
        amountKes,
        amountSubunits,
        amountUsd,
        currency: 'KES',
        sessionId: session.sessionId,
        checkoutUrl: session.checkoutUrl,
        status: 'pending',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const depositInsertErr = await withStoreFallback(
        async () => {
          const { error: depositError } = await getSupabaseClient()
            .from('deposits')
            .insert({
              id: newDeposit.id,
              user_id: newDeposit.userId,
              merchant_reference: newDeposit.merchantReference,
              amount_kes: newDeposit.amountKes,
              amount_subunits: newDeposit.amountSubunits,
              amount_usd: newDeposit.amountUsd,
              currency: newDeposit.currency,
              session_id: newDeposit.sessionId,
              checkout_url: newDeposit.checkoutUrl,
              status: newDeposit.status,
              created_at: newDeposit.createdAt,
              updated_at: newDeposit.updatedAt,
            });
          if (depositError && isSupabaseTransportError(depositError)) throw depositError;
          return depositError;
        },
        () => {
          localFallbackStore.insertDeposit({
            id: newDeposit.id,
            user_id: newDeposit.userId,
            merchant_reference: newDeposit.merchantReference,
            amount_kes: newDeposit.amountKes,
            amount_subunits: newDeposit.amountSubunits,
            amount_usd: newDeposit.amountUsd,
            currency: newDeposit.currency,
            session_id: newDeposit.sessionId,
            checkout_url: newDeposit.checkoutUrl,
            status: newDeposit.status,
            created_at: newDeposit.createdAt,
            updated_at: newDeposit.updatedAt,
          });
          return null;
        }
      );

      if (depositInsertErr) {
        console.error('[Deposit Save Error]:', depositInsertErr);
        return res.status(500).json({
          error: 'Could not save deposit. Please contact support.',
        });
      }

      return res.status(201).json({
        message: 'Paynecta checkout session created successfully.',
        deposit: {
          id: newDeposit.id,
          merchantReference: newDeposit.merchantReference,
          amountKes: newDeposit.amountKes,
          amountUsd: newDeposit.amountUsd,
          currency: 'KES',
          checkoutUrl: newDeposit.checkoutUrl,
          webhookUrl: session.webhookUrl,
          status: newDeposit.status,
          createdAt: newDeposit.createdAt,
        },
      });
    } catch (err: any) {
      console.error('[Paynecta Deposit Error]:', err?.message);
      const errMsg = err?.message || 'Unexpected error creating checkout session.';

      // Exact prompt required message when TapFlow is missing or inactive
      if (
        errMsg.includes('No active payment collection flow was found') ||
        errMsg.includes('setup incomplete')
      ) {
        return res.status(503).json({
          error: 'Paynecta setup incomplete. No active payment collection flow was found. Please configure or activate a TapFlow in your Paynecta account.',
          code: 'TAPFLOW_MISSING',
          message: 'Paynecta setup incomplete. No active payment collection flow was found. Please configure or activate a TapFlow in your Paynecta account.',
          help: 'To activate a TapFlow, log in to your Paynecta Dashboard (https://dashboard.paynecta.co.ke/) -> TapFlows, create or activate a Collection TapFlow, and set PAYNECTA_TAPFLOW_ID in server environment.',
        });
      }

      if (errMsg.includes('authentication failed') || errMsg.includes('401') || errMsg.includes('Secret Key')) {
        return res.status(502).json({
          error: 'Paynecta API Authentication Failed',
          code: 'PAYNECTA_AUTH_FAILED',
          message: errMsg,
        });
      }

      if (errMsg.includes('not authorized') || errMsg.includes('403')) {
        return res.status(502).json({
          error: 'Paynecta Account Not Authorized',
          code: 'PAYNECTA_FORBIDDEN',
          message: errMsg,
        });
      }

      return res.status(502).json({
        error: 'Payment service is temporarily unavailable.',
        code: 'PAYNECTA_UNAVAILABLE',
        message: errMsg,
      });
    }
  }
);

// 3. GET USER'S DEPOSIT HISTORY
app.get('/api/paynecta/deposits', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const data = await withStoreFallback(
      async () => {
        const { data: rows, error } = await getSupabaseClient()
          .from('deposits')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(50);
        if (error) throw error;
        return rows || [];
      },
      () => localFallbackStore.listDepositsByUser(user.id, 50)
    );

    const deposits = data.map((d: any) => ({
      id: d.id,
      userId: d.user_id,
      merchantReference: d.merchant_reference,
      amountKes: Number(d.amount_kes),
      amountSubunits: Number(d.amount_subunits),
      amountUsd: Number(d.amount_usd),
      currency: d.currency,
      sessionId: d.session_id,
      checkoutUrl: d.checkout_url,
      providerReference: d.provider_reference,
      receiptNumber: d.receipt_number,
      status: d.status,
      failureReason: d.failure_reason,
      confirmedAmountKes: d.confirmed_amount_kes == null ? undefined : Number(d.confirmed_amount_kes),
      createdAt: Number(d.created_at),
      updatedAt: Number(d.updated_at),
      confirmedAt: d.confirmed_at == null ? undefined : Number(d.confirmed_at),
    }));

    return res.json({ deposits });
  } catch (err: any) {
    console.error('[Deposit History Error]:', err);
    return res.status(500).json({ error: 'Could not load deposit history.' });
  }
});

// 4. VERIFY DEPOSIT STATUS (IDEMPOTENT INDEPENDENT RECONCILIATION)
// 4. VERIFY DEPOSIT STATUS (SUPABASE + ATOMIC CREDITING)
app.post(
  '/api/paynecta/verify-deposit/:id',
  requireAuth,
  rateLimitMiddleware(30, 60000),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const depositId = req.params.id;
      const user = req.user!;

      const row = await withStoreFallback(
        async () => {
          const { data, error } = await getSupabaseClient()
            .from('deposits')
            .select('*')
            .eq('id', depositId)
            .maybeSingle();
          if (error) throw error;
          return data;
        },
        () => localFallbackStore.findDepositById(depositId)
      );

      if (!row) {
        return res.status(404).json({ error: 'Deposit record not found.' });
      }

      if (row.user_id !== user.id && user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied.' });
      }

      const deposit: DepositRecord = {
        id: row.id,
        userId: row.user_id,
        merchantReference: row.merchant_reference,
        amountKes: Number(row.amount_kes),
        amountSubunits: Number(row.amount_subunits),
        amountUsd: Number(row.amount_usd),
        currency: row.currency as 'KES',
        sessionId: row.session_id || undefined,
        checkoutUrl: row.checkout_url || undefined,
        providerReference: row.provider_reference || undefined,
        receiptNumber: row.receipt_number || undefined,
        status: row.status as DepositRecord['status'],
        failureReason: row.failure_reason || undefined,
        confirmedAmountKes: row.confirmed_amount_kes == null
          ? undefined
          : Number(row.confirmed_amount_kes),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
        confirmedAt: row.confirmed_at == null
          ? undefined
          : Number(row.confirmed_at),
      };

      if (deposit.status === 'succeeded') {
        const account = await withStoreFallback(
          async () => {
            const { data, error } = await getSupabaseClient()
              .from('users')
              .select('real_balance')
              .eq('id', deposit.userId)
              .maybeSingle();
            if (error) throw error;
            return data;
          },
          () => localFallbackStore.findUserById(deposit.userId)
        );

        return res.json({
          status: 'succeeded',
          alreadyCredited: true,
          deposit,
          realBalance: Number(account?.real_balance ?? 0),
          message: 'Deposit already confirmed and credited.',
        });
      }

      const verification = await paynectaService.verifyCheckoutSession(
        deposit.sessionId || '',
        deposit.merchantReference
      );

      const now = Date.now();

      if (verification.status === 'succeeded') {
        if (verification.confirmedAmountKes === undefined) {
          console.error('[Paynecta Verification] Successful response omitted the confirmed amount:', deposit.id);
          return res.status(409).json({
            error: 'Paynecta did not return a confirmed payment amount. No balance was credited.',
          });
        }
        if (Math.round(verification.confirmedAmountKes) !== deposit.amountKes) {
          console.error('[Paynecta Amount Mismatch]', {
            depositId: deposit.id,
            expectedKes: deposit.amountKes,
            confirmedKes: verification.confirmedAmountKes,
          });
          return res.status(409).json({
            error: 'The confirmed payment amount does not match this deposit. No balance was credited; support reconciliation is required.',
          });
        }

        const providerReference =
          verification.providerReference ||
          verification.receiptNumber ||
          'PAYNECTA_VERIFIED';

        const receiptNumber =
          verification.receiptNumber ||
          verification.providerReference ||
          null;

        const creditResult = await withStoreFallback(
          async () => {
            const { data, error } = await getSupabaseClient().rpc(
              'confirm_paynecta_deposit',
              {
                p_deposit_id: deposit.id,
                p_provider_reference: providerReference,
                p_receipt_number: receiptNumber,
                p_confirmed_amount_kes: verification.confirmedAmountKes,
                p_source: 'verification',
              }
            );
            if (error) throw error;
            return data;
          },
          () =>
            localFallbackStore.confirmDeposit({
              depositId: deposit.id,
              providerReference,
              receiptNumber,
              confirmedAmountKes: verification.confirmedAmountKes!,
            })
        );

        if (!creditResult?.success) {
          console.error('[Atomic Deposit Credit Rejected]:', creditResult);
          return res.status(500).json({
            error: creditResult?.error || 'Could not confirm deposit credit.',
          });
        }

        const updatedDeposit: DepositRecord = {
          ...deposit,
          status: 'succeeded',
          providerReference,
          receiptNumber: receiptNumber || undefined,
          confirmedAmountKes: verification.confirmedAmountKes,
          confirmedAt: now,
          updatedAt: now,
        };

        return res.json({
          status: 'succeeded',
          alreadyCredited: creditResult.alreadyCredited,
          deposit: updatedDeposit,
          realBalance: Number(creditResult.realBalance),
          message: creditResult.alreadyCredited
            ? 'Deposit was already credited.'
            : `Payment confirmed! KES ${deposit.amountKes.toLocaleString()} received. Real balance credited with +$${deposit.amountUsd.toFixed(2)} USD.`,
        });
      }

      if (
        verification.status === 'failed' ||
        verification.status === 'cancelled'
      ) {
        const failureReason =
          verification.failureReason ||
          (verification.status === 'failed'
            ? 'Payment declined or refused by provider.'
            : 'Payment was cancelled.');

        await withStoreFallback(
          async () => {
            const { error } = await getSupabaseClient()
              .from('deposits')
              .update({
                status: verification.status,
                failure_reason: failureReason,
                updated_at: now,
              })
              .eq('id', deposit.id)
              .neq('status', 'succeeded');
            if (error) throw error;
          },
          () => {
            localFallbackStore.updateDeposit(
              deposit.id,
              {
                status: verification.status,
                failure_reason: failureReason,
                updated_at: now,
              },
              { neqStatus: 'succeeded' }
            );
          }
        );

        return res.json({
          status: verification.status,
          deposit: {
            ...deposit,
            status: verification.status,
            failureReason,
            updatedAt: now,
          },
          message: failureReason,
        });
      }

      await withStoreFallback(
        async () => {
          const { error } = await getSupabaseClient()
            .from('deposits')
            .update({ updated_at: now })
            .eq('id', deposit.id);
          if (error) throw error;
        },
        () => {
          localFallbackStore.updateDeposit(deposit.id, { updated_at: now });
        }
      );

      if (verification.status === 'verification_delayed') {
        return res.json({
          status: 'verification_delayed',
          deposit: { ...deposit, updatedAt: now },
          message:
            verification.failureReason ||
            'Verification is delayed. Paynecta is reconciling settlement with the network.',
        });
      }

      return res.json({
        status: 'pending',
        deposit: { ...deposit, updatedAt: now },
        message: 'Awaiting customer approval and M-Pesa network confirmation.',
      });
    } catch (err: any) {
      console.error('[Paynecta Verify Error]:', err);
      return res.status(500).json({
        error: 'Failed to verify deposit status',
        message: err.message || 'Unexpected error checking payment status.',
      });
    }
  }
);

// 5. CANCEL PENDING DEPOSIT
app.post(
  '/api/paynecta/cancel-deposit/:id',
  requireAuth,
  rateLimitMiddleware(10, 60000),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const depositId = req.params.id;
      const user = req.user!;

      const deposit = await withStoreFallback(
        async () => {
          const { data, error } = await getSupabaseClient()
            .from('deposits')
            .select('*')
            .eq('id', depositId)
            .maybeSingle();
          if (error) throw error;
          return data;
        },
        () => localFallbackStore.findDepositById(depositId)
      );

      if (!deposit) {
        return res.status(404).json({ error: 'Deposit record not found.' });
      }

      if (deposit.user_id !== user.id && user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied.' });
      }

      if (deposit.status === 'succeeded') {
        return res.status(409).json({
          error: 'A successful payment cannot be cancelled.',
          deposit,
        });
      }

      if (deposit.status === 'pending') {
        const now = Date.now();
        const updatedDeposit = await withStoreFallback(
          async () => {
            const { data, error } = await getSupabaseClient()
              .from('deposits')
              .update({
                status: 'cancelled',
                failure_reason: 'Cancelled by user.',
                updated_at: now,
              })
              .eq('id', depositId)
              .eq('status', 'pending')
              .select()
              .maybeSingle();
            if (error) throw error;
            return data;
          },
          () =>
            localFallbackStore.updateDeposit(
              depositId,
              {
                status: 'cancelled',
                failure_reason: 'Cancelled by user.',
                updated_at: now,
              },
              { eqStatus: 'pending' }
            )
        );

        return res.json({
          message: updatedDeposit
            ? 'Deposit marked as cancelled.'
            : 'Deposit status has already changed.',
          deposit: updatedDeposit || deposit,
        });
      }

      return res.json({
        message: 'Deposit is not pending and was not changed.',
        deposit,
      });
    } catch (err: any) {
      console.error('[Cancel Deposit Error]:', err);
      return res.status(500).json({
        error: 'Could not cancel deposit.',
      });
    }
  }
);

// 6. PAYNECTA WEBHOOK RECEIVER (HMAC-SHA256 SIGNED WITH REPLAY PROTECTION)
app.post('/api/paynecta/webhook', async (req: Request, res: Response) => {
  try {
    const signature = (
      req.headers['paynecta-signature'] ||
      req.headers['x-paynecta-signature'] ||
      req.headers['x-signature'] ||
      ''
    ) as string;

    const timestamp = (
      req.headers['paynecta-timestamp'] ||
      req.headers['x-paynecta-timestamp'] ||
      ''
    ) as string;

    const rawBody = (req as any).rawBody
      ? (req as any).rawBody.toString('utf-8')
      : JSON.stringify(req.body);

    const verification = paynectaService.verifyWebhook({
      rawBody,
      signatureHeader: signature,
      timestampHeader: timestamp,
    });

    const config = paynectaService.getConfig();

    if (config.webhookSecret && !verification.isValid) {
      console.warn('[Paynecta Webhook] Verification failed:', verification.reason);
      return res.status(401).json({
        error: 'Invalid webhook signature or expired timestamp.',
      });
    }

    if (!config.webhookSecret) {
      console.error('[Paynecta Webhook] Rejected: webhook secret is not configured.');
      return res.status(503).json({
        error: 'Webhook verification is not configured.',
      });
    }

    const event = req.body || {};

    const merchantReference =
      event.data?.merchant_reference ||
      event.merchant_reference ||
      event.payment?.merchant_reference;

    const sessionId =
      event.session_id ||
      event.data?.session_id ||
      event.data?.id ||
      event.id;

    const providerReference =
      event.data?.reference ||
      event.payment?.reference ||
      event.transaction_id ||
      event.data?.transaction_id ||
      event.receipt_number ||
      event.data?.receipt_number;

    const receiptNumber =
      event.data?.receipt ||
      event.payment?.receipt ||
      event.receipt_number ||
      event.data?.receipt_number;

    if (!merchantReference && !sessionId && !providerReference) {
      return res.status(400).json({
        error: 'Missing merchant reference or session ID in webhook event.',
      });
    }

    const deposit = await withStoreFallback(
      async () => {
        let depositQuery = getSupabaseClient().from('deposits').select('*');

        if (merchantReference) {
          depositQuery = depositQuery.eq('merchant_reference', merchantReference);
        } else if (sessionId) {
          depositQuery = depositQuery.eq('session_id', sessionId);
        } else {
          depositQuery = depositQuery.eq('provider_reference', providerReference);
        }

        const { data, error } = await depositQuery.maybeSingle();
        if (error) throw error;
        return data;
      },
      () =>
        localFallbackStore.findDepositByLookup({
          merchantReference,
          sessionId,
          providerReference,
        })
    );

    if (!deposit) {
      console.warn('[Paynecta Webhook] No matching deposit:', merchantReference || sessionId);
      return res.json({ received: true, note: 'Deposit not found.' });
    }

    const eventType = String(req.headers['paynecta-event'] || event.event || event.data?.event || event.type || '').toLowerCase();

    const eventStatus = String(
      event.status ||
      event.data?.status ||
      event.payment?.status ||
      ''
    ).toLowerCase();

    if (
      eventStatus === 'succeeded' ||
      eventStatus === 'completed' ||
      eventStatus === 'paid' ||
      eventType.includes('payment.settled') ||
      eventType.includes('payment.succeeded') ||
      eventType.includes('checkout.session.completed')
    ) {
      // The signed webhook is authoritative. Paynecta sends amount in KES cents.
      const paidSubunits = Number(event.data?.amount ?? event.amount);
      const currency = String(event.data?.currency ?? event.currency ?? '').toUpperCase();
      if (
        !Number.isSafeInteger(paidSubunits) ||
        paidSubunits !== Number(deposit.amount_subunits) ||
        currency !== 'KES'
      ) {
        console.error('[Paynecta Webhook] Amount/currency mismatch; deposit not credited:', deposit.id);
        return res.status(409).json({ error: 'Payment amount or currency mismatch; no balance was credited.' });
      }

      const creditResult = await withStoreFallback(
        async () => {
          const { data, error } = await getSupabaseClient().rpc(
            'confirm_paynecta_deposit',
            {
              p_deposit_id: deposit.id,
              p_provider_reference: providerReference || 'PAYNECTA_WEBHOOK',
              p_receipt_number: receiptNumber || null,
              p_confirmed_amount_kes: paidSubunits / 100,
              p_source: 'webhook',
            }
          );
          if (error) throw error;
          return data;
        },
        () =>
          localFallbackStore.confirmDeposit({
            depositId: deposit.id,
            providerReference: providerReference || 'PAYNECTA_WEBHOOK',
            receiptNumber: receiptNumber || null,
            confirmedAmountKes: paidSubunits / 100,
          })
      );

      if (!creditResult?.success) {
        console.error('[Paynecta Webhook] Atomic credit failed:', creditResult);
        return res.status(500).json({
          error: 'Payment received but deposit crediting needs reconciliation.',
        });
      }

      console.log(
        `[Paynecta Webhook] Deposit ${deposit.id} processed. Already credited: ${creditResult.alreadyCredited}`
      );
    } else if (
      eventStatus === 'cancelled' ||
      eventStatus === 'abandoned' ||
      eventStatus === 'expired' ||
      eventType.includes('payment.cancelled')
    ) {
      const now = Date.now();
      await withStoreFallback(
        async () => {
          const { error } = await getSupabaseClient()
            .from('deposits')
            .update({
              status: 'cancelled',
              failure_reason: 'Payment was cancelled by user.',
              updated_at: now,
            })
            .eq('id', deposit.id)
            .neq('status', 'succeeded');
          if (error) throw error;
        },
        () => {
          localFallbackStore.updateDeposit(
            deposit.id,
            {
              status: 'cancelled',
              failure_reason: 'Payment was cancelled by user.',
              updated_at: now,
            },
            { neqStatus: 'succeeded' }
          );
        }
      );
    } else if (
      eventStatus === 'failed' ||
      eventStatus === 'declined' ||
      eventStatus === 'refused' ||
      eventStatus === 'insufficient_funds' ||
      eventStatus === 'timed_out' ||
      eventType.includes('payment.failed')
    ) {
      const now = Date.now();
      const failureReason =
        event.failure_reason ||
        event.data?.failure_reason ||
        'Payment failed.';
      await withStoreFallback(
        async () => {
          const { error } = await getSupabaseClient()
            .from('deposits')
            .update({
              status: 'failed',
              failure_reason: failureReason,
              updated_at: now,
            })
            .eq('id', deposit.id)
            .neq('status', 'succeeded');
          if (error) throw error;
        },
        () => {
          localFallbackStore.updateDeposit(
            deposit.id,
            {
              status: 'failed',
              failure_reason: failureReason,
              updated_at: now,
            },
            { neqStatus: 'succeeded' }
          );
        }
      );
    }

    return res.json({ received: true });
  } catch (err: any) {
    console.error('[Paynecta Webhook Error]:', err);
    return res.status(500).json({ error: 'Webhook processing failed.' });
  }
});

// 12. PERSISTENT MARKET ENGINE ENDPOINTS
app.get('/api/market/snapshot', async (req: Request, res: Response) => {
  try {
    await marketEngine.ensureUpToDate();
    const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.trim() : '';
    const atEpochRaw = Number(req.query.atEpoch);

    if (symbol) {
      const snapshot = marketEngine.getInstrumentSnapshot(symbol);
      if (!snapshot) {
        return res.status(404).json({ error: `Unknown market instrument: ${symbol}` });
      }
      const tickAtTarget =
        Number.isFinite(atEpochRaw) && atEpochRaw > 0
          ? marketEngine.getPriceAtOrAfter(symbol, atEpochRaw)
          : null;

      return res.json({
        symbol: snapshot.symbol,
        currentQuote: snapshot.lastQuote,
        direction: snapshot.direction,
        lastDigit: snapshot.lastDigit,
        lastTickEpoch: snapshot.lastTickEpoch,
        serverTime: Date.now(),
        ticks: snapshot.ticks,
        candles: snapshot.candles,
        tickAtTarget,
      });
    }

    const markets = marketEngine.getAllLatestTicks();
    return res.json({
      serverTime: Date.now(),
      markets,
    });
  } catch (error) {
    console.error('[Market Snapshot Error]:', error);
    return res.status(500).json({ error: 'Could not read market state.' });
  }
});

app.get('/api/market/stream', async (req: Request, res: Response) => {
  await marketEngine.ensureUpToDate();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  req.socket?.setTimeout?.(0);
  res.flushHeaders?.();

  const initialFrame = {
    serverTime: Date.now(),
    ticks: marketEngine.getAllLatestTicks(),
  };
  res.write(`event: init\ndata: ${JSON.stringify(initialFrame)}\n\n`);

  const unsub = marketEngine.subscribe((frame) => {
    try {
      res.write(`event: tick\ndata: ${JSON.stringify(frame)}\n\n`);
    } catch {
      unsub();
    }
  });

  const keepAlive = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch {
      clearInterval(keepAlive);
      unsub();
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(keepAlive);
    unsub();
  });
});

// 13. HEALTH CHECK
app.get(['/api/health', '/api', '/health'], (req: Request, res: Response) => {
  return res.json({ status: 'ok', service: 'DevOptions Backend', timestamp: Date.now() });
});

// Fallback for unmatched API routes to guarantee a JSON response (never HTML)
app.all('/api/*', (req: Request, res: Response) => {
  return res.status(404).json({
    error: `API route not found: ${req.method} ${req.path}`,
    status: 404,
  });
});

// Export only the Express application. Vercel handles the server lifecycle.
export default app;

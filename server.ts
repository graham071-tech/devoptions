import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { paynectaService } from './src/services/paynectaService';
import { getSupabaseClient } from './src/services/supabaseService';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
export { app };

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
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin.replace(/\/+$/, ''))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
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

function setSessionCookie(res: Response, token: string) {
  const isProd = process.env.NODE_ENV === 'production';
  const cookieParts = [
    `devoptions_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${7 * 24 * 60 * 60}`,
    isProd ? 'Secure' : '',
  ].filter(Boolean);
  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

function clearSessionCookie(res: Response) {
  const isProd = process.env.NODE_ENV === 'production';
  const cookieParts = [
    'devoptions_session=',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    isProd ? 'Secure' : '',
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
  const hash = crypto.scryptSync(password, salt, 64);
  const storedBuf = Buffer.from(storedHash, 'hex');
  if (hash.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(hash, storedBuf);
}

function generateSecureOtp(): string {
  // 6-digit random number
  const num = crypto.randomInt(100000, 999999);
  return num.toString();
}

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizePhone(phone: string): string {
  let cleaned = phone.trim().replace(/[\s\-\(\)\.]/g, '');
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

function rateLimitMiddleware(limit = 15, windowMs = 60 * 1000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${ip}:${req.path}`;
    const now = Date.now();

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

// ─────────────────────────────────────────────────────────────
// AUTHENTICATION MIDDLEWARE
// ─────────────────────────────────────────────────────────────
interface AuthenticatedRequest extends Request {
  user?: UserRecord;
  sessionToken?: string;
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

    const supabase = getSupabaseClient();

    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('*')
      .eq('token', token)
      .maybeSingle();

    if (sessionError) {
      console.error('[Supabase Session Error]:', sessionError);
      return res.status(500).json({ error: 'Could not verify session.' });
    }

    if (!session) {
      return res.status(401).json({
        error: 'Invalid token',
        message: 'Authentication could not be verified.',
        code: 'INVALID_TOKEN',
      });
    }

    if (Number(session.expires_at) < Date.now()) {
      await supabase.from('sessions').delete().eq('token', token);

      return res.status(401).json({
        error: 'Session expired',
        message: 'Your session has expired. Please log in again.',
        code: 'SESSION_EXPIRED',
      });
    }

    const { data: row, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', session.user_id)
      .maybeSingle();

    if (userError) {
      console.error('[Supabase User Error]:', userError);
      return res.status(500).json({ error: 'Could not verify account.' });
    }

    if (!row) {
      return res.status(401).json({
        error: 'Account inactive',
        message: 'Contact support for assistance.',
        code: 'ACCOUNT_INACTIVE',
      });
    }

    const user: UserRecord = {
      id: row.id,
      email: row.email,
      phone: row.phone,
      passwordHash: row.password_hash,
      salt: row.salt,
      role: row.role,
      createdAt: Number(row.created_at),
      emailVerified: row.email_verified,
      phoneVerified: row.phone_verified,
      emailVerificationCode: row.email_verification_code || undefined,
      emailVerificationExpires: row.email_verification_expires == null
        ? undefined
        : Number(row.email_verification_expires),
      phoneVerificationCode: row.phone_verification_code || undefined,
      phoneVerificationExpires: row.phone_verification_expires == null
        ? undefined
        : Number(row.phone_verification_expires),
      resetPasswordToken: row.reset_password_token || undefined,
      resetPasswordExpires: row.reset_password_expires == null
        ? undefined
        : Number(row.reset_password_expires),
      demoBalance: Number(row.demo_balance),
      realBalance: Number(row.real_balance),
      fullName: row.full_name || '',
      country: row.country || 'International',
      theme: row.theme || undefined,
      soundEnabled: row.sound_enabled ?? undefined,
    };

    req.user = user;
    req.sessionToken = token;

    return next();
  } catch (err) {
    console.error('[Supabase Authentication Error]:', err);
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
    fullName: user.fullName || '',
    country: user.country || 'International',
    createdAt: user.createdAt,
    emailProviderConfigured: Boolean(process.env.SMTP_HOST || process.env.SENDGRID_API_KEY),
    smsProviderConfigured: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
    devNotice:
      !user.emailVerified || !user.phoneVerified
        ? {
            emailOtp: !user.emailVerified ? lastEmailOtp || user.emailVerificationCode : undefined,
            phoneOtp: !user.phoneVerified ? lastPhoneOtp || user.phoneVerificationCode : undefined,
            info: Boolean(process.env.SMTP_HOST || process.env.SENDGRID_API_KEY)
              ? 'Verification code has been dispatched to your registered email.'
              : 'External email service is not yet configured on this server. Use the sandbox OTP code provided below to verify your account.',
            emailConfigured: Boolean(process.env.SMTP_HOST || process.env.SENDGRID_API_KEY),
            smsConfigured: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
          }
        : undefined,
  };
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
      const { email, phone, password, confirmPassword } = req.body;

      if (!email || !phone || !password) {
        return res.status(400).json({ error: 'Email, phone number, and password are required.' });
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

      const supabase = getSupabaseClient();

      const { data: existingEmail } = await supabase
        .from('users')
        .select('id')
        .eq('email', normEmail)
        .maybeSingle();

      if (existingEmail) {
        return res.status(409).json({
          error: 'An account with this email address already exists.',
        });
      }

      const { data: existingPhone } = await supabase
        .from('users')
        .select('id')
        .eq('phone', normPhone)
        .maybeSingle();

      if (existingPhone) {
        return res.status(409).json({
          error: 'An account with this phone number already exists.',
        });
      }

      const salt = crypto.randomBytes(16).toString('hex');
      const passwordHash = hashPassword(password, salt);
      const emailOtp = generateSecureOtp();
      const phoneOtp = generateSecureOtp();
      const now = Date.now();
      const otpExpiry = now + 15 * 60 * 1000;

      const newUser: UserRecord = {
        id: `usr_${crypto.randomUUID()}`,
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
        fullName: '',
        country: 'International',
      };

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
        console.error('[Supabase Registration Error]:', userError);

        if (userError.code === '23505') {
          return res.status(409).json({
            error: 'An account with this email address or phone number already exists.',
          });
        }

        return res.status(500).json({ error: 'Could not create your account.' });
      }

      const sessionToken = generateToken();

      const { error: sessionError } = await supabase.from('sessions').insert({
        token: sessionToken,
        user_id: newUser.id,
        created_at: now,
        expires_at: now + 7 * 24 * 60 * 60 * 1000,
      });

      if (sessionError) {
        console.error('[Supabase Registration Session Error]:', sessionError);
        await supabase.from('users').delete().eq('id', newUser.id);

        return res.status(500).json({
          error: 'Your account was created, but we could not start your session. Please try logging in.',
        });
      }

      setSessionCookie(res, sessionToken);

      const isDevelopment = process.env.NODE_ENV !== 'production';

      if (isDevelopment) {
        console.log(`[DevOptions Auth] New User Registered: ${normEmail}`);
      }

      return res.status(201).json({
        message: 'Account registered successfully. Please verify your contact details.',
        token: sessionToken,
        user: safeUserResponse(
          newUser,
          isDevelopment ? emailOtp : undefined,
          isDevelopment ? phoneOtp : undefined
        ),
      });
    } catch (err) {
      console.error('[Supabase Registration Error]:', err);
      return res.status(500).json({ error: 'Registration service is unavailable.' });
    }
  }
);

// Shared Supabase row mapper for all authenticated routes.
function userFromRow(row: any): UserRecord {
  return {
    id: row.id, email: row.email, phone: row.phone,
    passwordHash: row.password_hash, salt: row.salt, role: row.role,
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
app.post('/api/auth/login', rateLimitMiddleware(15, 60000), async (req: Request, res: Response) => {
  try {
    const { identifier, password } = req.body || {};
    if (typeof identifier !== 'string' || typeof password !== 'string' || !identifier.trim() || !password) {
      return res.status(400).json({ error: 'Email/Phone and password are required.' });
    }
    const isEmail = identifier.trim().includes('@');
    const normalized = isEmail ? normalizeEmail(identifier) : normalizePhone(identifier);
    const supabase = getSupabaseClient();
    const { data: row, error } = await supabase.from('users').select('*')
      .eq(isEmail ? 'email' : 'phone', normalized).maybeSingle();
    if (error) throw error;
    if (!row || !verifyPassword(password, row.salt, row.password_hash)) {
      return res.status(401).json({ error: 'Invalid email, phone, or password.' });
    }
    const now = Date.now(), token = generateToken();
    const { error: sessionError } = await supabase.from('sessions').insert({
      token, user_id: row.id, created_at: now, expires_at: now + 7 * 24 * 60 * 60 * 1000,
    });
    if (sessionError) throw sessionError;
    setSessionCookie(res, token);
    const user = userFromRow(row);
    return res.json({ message: 'Logged in successfully.', token, user: safeUserResponse(user) });
  } catch (error) {
    console.error('[Supabase Login Error]:', error);
    return res.status(500).json({ error: 'Login service is unavailable.' });
  }
});

// 3. LOGOUT
app.post('/api/auth/logout', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { error } = await getSupabaseClient().from('sessions').delete().eq('token', req.sessionToken);
    if (error) throw error;
    clearSessionCookie(res);
    return res.json({ message: 'Logged out successfully.' });
  } catch (error) {
    console.error('[Supabase Logout Error]:', error);
    return res.status(500).json({ error: 'Could not log out. Please try again.' });
  }
});

// 4. CURRENT USER
app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) =>
  res.json({ user: safeUserResponse(req.user!) })
);

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
    const { data, error } = await getSupabaseClient().from('users').update(patch).eq('id', user.id).select('*').single();
    if (error) throw error;
    return res.json({ message: `${type === 'email' ? 'Email' : 'Phone number'} verified successfully!`, user: safeUserResponse(userFromRow(data)) });
  } catch (error) {
    console.error('[Supabase Verification Error]:', error);
    return res.status(500).json({ error: 'Verification service is unavailable.' });
  }
}
app.post('/api/auth/verify-email', requireAuth, (req: AuthenticatedRequest, res: Response) => verifyContact(req, res, 'email'));
app.post('/api/auth/verify-phone', requireAuth, (req: AuthenticatedRequest, res: Response) => verifyContact(req, res, 'phone'));

// 7. RESEND VERIFICATION CODE
app.post('/api/auth/resend-code', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
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
    const { data, error } = await getSupabaseClient().from('users').update(patch).eq('id', user.id).select('*').single();
    if (error) throw error;
    const updated = userFromRow(data);
    return res.json({
      message: `New ${type} verification code generated.`,
      user: safeUserResponse(updated, type === 'email' && process.env.NODE_ENV !== 'production' ? otp : undefined,
        type === 'phone' && process.env.NODE_ENV !== 'production' ? otp : undefined),
    });
  } catch (error) {
    console.error('[Supabase Resend Error]:', error);
    return res.status(500).json({ error: 'Could not generate a new verification code.' });
  }
});

// 8. FORGOT PASSWORD
app.post('/api/auth/forgot-password', rateLimitMiddleware(5, 60000), async (req: Request, res: Response) => {
  try {
    const identifier = req.body?.identifier;
    if (typeof identifier !== 'string' || !identifier.trim()) return res.status(400).json({ error: 'Please provide your registered email or phone number.' });
    const isEmail = identifier.trim().includes('@'), normalized = isEmail ? normalizeEmail(identifier) : normalizePhone(identifier);
    const supabase = getSupabaseClient();
    const { data: row, error } = await supabase.from('users').select('id').eq(isEmail ? 'email' : 'phone', normalized).maybeSingle();
    if (error) throw error;
    const generic = 'If an account matches that contact method, a verification code has been dispatched.';
    if (!row) return res.json({ message: generic });
    const otp = generateSecureOtp(), expiry = Date.now() + 30 * 60 * 1000;
    const { error: updateError } = await supabase.from('users').update({ reset_password_token: otp, reset_password_expires: expiry }).eq('id', row.id);
    if (updateError) throw updateError;
    // OTP is returned only outside production until an email/SMS delivery provider is configured.
    return res.json({ message: generic, ...(process.env.NODE_ENV !== 'production' ? { devOtp: otp } : {}) });
  } catch (error) {
    console.error('[Supabase Forgot Password Error]:', error);
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
    const supabase = getSupabaseClient();
    const { data: row, error } = await supabase.from('users').select('*').eq(isEmail ? 'email' : 'phone', normalized).maybeSingle();
    if (error) throw error;
    if (!row || row.reset_password_token !== String(code).trim() || !row.reset_password_expires || Number(row.reset_password_expires) < Date.now()) {
      return res.status(400).json({ error: 'Invalid or expired password reset code.' });
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(newPassword, salt);
    const { error: updateError } = await supabase.from('users').update({
      salt, password_hash: passwordHash, reset_password_token: null, reset_password_expires: null,
    }).eq('id', row.id);
    if (updateError) throw updateError;
    const { error: sessionError } = await supabase.from('sessions').delete().eq('user_id', row.id);
    if (sessionError) throw sessionError;
    return res.json({ message: 'Password has been reset successfully. Please log in with your new password.' });
  } catch (error) {
    console.error('[Supabase Reset Password Error]:', error);
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
    const { data, error } = await getSupabaseClient().from('users').update(patch).eq('id', req.user!.id).select('*').single();
    if (error) throw error;
    return res.json({ message: 'Profile updated.', user: safeUserResponse(userFromRow(data)) });
  } catch (error) {
    console.error('[Supabase Profile Error]:', error);
    return res.status(500).json({ error: 'Could not update profile.' });
  }
});

// 11. USER TRADES
app.get('/api/user/trades', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await getSupabaseClient().from('trades').select('trade_data')
      .eq('user_id', req.user!.id).order('recorded_at', { ascending: false }).limit(50);
    if (error) throw error;
    return res.json({ trades: (data || []).map((row: any) => row.trade_data) });
  } catch (error) {
    console.error('[Supabase Trades Read Error]:', error);
    return res.status(500).json({ error: 'Could not load trade history.' });
  }
});
app.post('/api/user/trades', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const trade = req.body;
    if (!trade || typeof trade !== 'object' || !trade.id) return res.status(400).json({ error: 'Invalid trade payload' });
    const saved = { ...trade, userId: req.user!.id, recordedAt: Date.now() };
    const { error } = await getSupabaseClient().from('trades').upsert({
      id: String(saved.id), user_id: req.user!.id, trade_data: saved, recorded_at: saved.recordedAt,
    }, { onConflict: 'id' });
    if (error) throw error;
    return res.status(201).json({ message: 'Trade saved', trade: saved });
  } catch (error) {
    console.error('[Supabase Trade Save Error]:', error);
    return res.status(500).json({ error: 'Could not save trade.' });
  }
});

// ─────────────────────────────────────────────────────────────
// ADMINISTRATOR API ROUTES
// ─────────────────────────────────────────────────────────────
app.get('/api/admin/overview', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const supabase = getSupabaseClient();
    const [usersResult, sessionsResult, tradesResult] = await Promise.all([
      supabase.from('users').select('id,role,email_verified,phone_verified', { count: 'exact' }),
      supabase.from('sessions').select('token', { count: 'exact' }).gt('expires_at', Date.now()),
      supabase.from('trades').select('trade_data'),
    ]);
    if (usersResult.error || sessionsResult.error || tradesResult.error) throw usersResult.error || sessionsResult.error || tradesResult.error;
    const trades = (tradesResult.data || []).map((x: any) => x.trade_data || {});
    return res.json({ metrics: {
      totalUsers: usersResult.count || 0,
      verifiedUsers: (usersResult.data || []).filter((u: any) => u.email_verified && u.phone_verified).length,
      activeSessions: sessionsResult.count || 0, totalTrades: trades.length,
      totalVolume: Number(trades.reduce((n: number, t: any) => n + (Number(t.stake) || 0), 0).toFixed(2)),
      netProfitLoss: Number(trades.reduce((n: number, t: any) => n + (Number(t.profit) || 0), 0).toFixed(2)),
      adminsCount: (usersResult.data || []).filter((u: any) => u.role === 'admin').length,
    }});
  } catch (error) {
    console.error('[Supabase Admin Overview Error]:', error);
    return res.status(500).json({ error: 'Could not load administrator overview.' });
  }
});
app.get('/api/admin/users', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await getSupabaseClient().from('users').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return res.json({ users: (data || []).map((row: any) => safeUserResponse(userFromRow(row))) });
  } catch (error) {
    console.error('[Supabase Admin Users Error]:', error);
    return res.status(500).json({ error: 'Could not load users.' });
  }
});
app.post('/api/admin/users/:id/role', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const role = req.body?.role;
    if (role !== 'admin' && role !== 'user') return res.status(400).json({ error: 'Role must be either "admin" or "user".' });
    const supabase = getSupabaseClient();
    const { data: target, error: findError } = await supabase.from('users').select('*').eq('id', req.params.id).maybeSingle();
    if (findError) throw findError;
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (target.role === 'admin' && role === 'user') {
      const { count, error } = await supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'admin');
      if (error) throw error;
      if ((count || 0) <= 1) return res.status(400).json({ error: 'Cannot demote the last remaining administrator.' });
    }
    const { data, error } = await supabase.from('users').update({ role }).eq('id', req.params.id).select('*').single();
    if (error) throw error;
    return res.json({ message: `User ${target.email} role updated to ${role}.`, user: safeUserResponse(userFromRow(data)) });
  } catch (error) {
    console.error('[Supabase Role Update Error]:', error);
    return res.status(500).json({ error: 'Could not update user role.' });
  }
});
app.post('/api/admin/users/:id/balance', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { accountType, amount, operation } = req.body || {};
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) return res.status(400).json({ error: 'Please specify a valid positive numerical amount.' });
    if (accountType !== 'real' && accountType !== 'demo') return res.status(400).json({ error: 'Account type must be real or demo.' });
    const supabase = getSupabaseClient();
    const { data: target, error: findError } = await supabase.from('users').select('*').eq('id', req.params.id).maybeSingle();
    if (findError) throw findError;
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    const column = accountType === 'real' ? 'real_balance' : 'demo_balance';
    const current = Number(target[column] || 0);
    const updatedValue = operation === 'set' ? value : Math.max(0, current + value);
    const { data, error } = await supabase.from('users').update({ [column]: updatedValue }).eq('id', req.params.id).select('*').single();
    if (error) throw error;
    return res.json({ message: `Account balance updated for ${target.email}.`, user: safeUserResponse(userFromRow(data)) });
  } catch (error) {
    console.error('[Supabase Balance Update Error]:', error);
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
    const supabase = getSupabaseClient();
    const { data: existing, error: findError } = await supabase.from('users').select('*').eq('email', normalizedEmail).maybeSingle();
    if (findError) throw findError;
    if (existing) {
      const { data, error } = await supabase.from('users').update({ role: 'admin', email_verified: true, phone_verified: true }).eq('id', existing.id).select('*').single();
      if (error) throw error;
      return res.json({ message: `Existing user ${normalizedEmail} promoted to administrator.`, user: safeUserResponse(userFromRow(data)) });
    }
    if (!normalizedPhone || !validatePhone(normalizedPhone)) return res.status(400).json({ error: 'A valid international phone number is required for a new administrator.' });
    const salt = crypto.randomBytes(16).toString('hex'), now = Date.now();
    const newAdmin: UserRecord = {
      id: `admin_${crypto.randomUUID()}`, email: normalizedEmail, phone: normalizedPhone,
      passwordHash: hashPassword(password, salt), salt, role: 'admin', createdAt: now,
      emailVerified: true, phoneVerified: true, demoBalance: 10000, realBalance: 0,
      fullName: fullName || 'DevOptions Administrator', country: 'International',
    };
    const { error } = await supabase.from('users').insert(userToRow(newAdmin));
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'An account with this email or phone already exists.' });
      throw error;
    }
    return res.status(201).json({ message: 'New administrator account created successfully.', user: safeUserResponse(newAdmin) });
  } catch (error) {
    console.error('[Supabase Create Admin Error]:', error);
    return res.status(500).json({ error: 'Could not create administrator account.' });
  }
});
app.delete('/api/admin/users/:id', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user!.id === req.params.id) return res.status(400).json({ error: 'Administrators cannot delete their own active account.' });
    const supabase = getSupabaseClient();
    const { data: target, error: findError } = await supabase.from('users').select('id,email,role').eq('id', req.params.id).maybeSingle();
    if (findError) throw findError;
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (target.role === 'admin') {
      const { count, error } = await supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'admin');
      if (error) throw error;
      if ((count || 0) <= 1) return res.status(400).json({ error: 'Cannot delete the last remaining administrator.' });
    }
    const { error } = await supabase.from('users').delete().eq('id', req.params.id);
    if (error) throw error;
    return res.json({ message: `User ${target.email} has been deleted.` });
  } catch (error) {
    console.error('[Supabase Delete User Error]:', error);
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
          error: `Minimum deposit is KES ${config.minDepositKes.toLocaleString()} (approx. $${config.minDepositUsd.toFixed(2)} USD).`,
        });
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

      const appUrl = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
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

            const supabase = getSupabaseClient();

      const { error: depositError } = await supabase
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

      if (depositError) {
        console.error('[Supabase Deposit Save Error]:', depositError);
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
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('deposits')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('[Supabase Deposit History Error]:', error);
      return res.status(500).json({ error: 'Could not load deposit history.' });
    }

    const deposits = (data || []).map((d) => ({
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
    console.error('[Supabase Deposit History Error]:', err);
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
      const supabase = getSupabaseClient();

      const { data: row, error: fetchError } = await supabase
        .from('deposits')
        .select('*')
        .eq('id', depositId)
        .maybeSingle();

      if (fetchError) {
        console.error('[Supabase Deposit Fetch Error]:', fetchError);
        return res.status(500).json({ error: 'Could not load deposit.' });
      }

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
        currency: row.currency,
        sessionId: row.session_id,
        checkoutUrl: row.checkout_url,
        providerReference: row.provider_reference,
        receiptNumber: row.receipt_number,
        status: row.status,
        failureReason: row.failure_reason,
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
        const { data: account } = await supabase
          .from('users')
          .select('real_balance')
          .eq('id', deposit.userId)
          .maybeSingle();

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
        const providerReference =
          verification.providerReference ||
          verification.receiptNumber ||
          'PAYNECTA_VERIFIED';

        const receiptNumber =
          verification.receiptNumber ||
          verification.providerReference ||
          null;

        const { data: creditResult, error: creditError } = await supabase.rpc(
          'confirm_paynecta_deposit',
          {
            p_deposit_id: deposit.id,
            p_provider_reference: providerReference,
            p_receipt_number: receiptNumber,
            p_confirmed_amount_kes:
              verification.confirmedAmountKes ?? deposit.amountKes,
            p_source: 'verification',
          }
        );

        if (creditError) {
          console.error('[Atomic Deposit Credit Error]:', creditError);
          return res.status(500).json({
            error: 'Payment was verified, but balance crediting needs reconciliation.',
          });
        }

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
          confirmedAmountKes:
            verification.confirmedAmountKes ?? deposit.amountKes,
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

        const { error: updateError } = await supabase
          .from('deposits')
          .update({
            status: verification.status,
            failure_reason: failureReason,
            updated_at: now,
          })
          .eq('id', deposit.id)
          .neq('status', 'succeeded');

        if (updateError) {
          console.error('[Deposit Status Update Error]:', updateError);
          return res.status(500).json({
            error: 'Could not update deposit status.',
          });
        }

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

      await supabase
        .from('deposits')
        .update({ updated_at: now })
        .eq('id', deposit.id);

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
);

// 5. CANCEL PENDING DEPOSIT
// 5. CANCEL PENDING DEPOSIT (SUPABASE)
app.post(
  '/api/paynecta/cancel-deposit/:id',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const depositId = req.params.id;
      const user = req.user!;
      const supabase = getSupabaseClient();

      const { data: deposit, error: fetchError } = await supabase
        .from('deposits')
        .select('*')
        .eq('id', depositId)
        .maybeSingle();

      if (fetchError) {
        console.error('[Supabase Cancel Deposit Fetch Error]:', fetchError);
        return res.status(500).json({ error: 'Could not load deposit.' });
      }

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
        const { data: updatedDeposit, error: updateError } = await supabase
          .from('deposits')
          .update({
            status: 'cancelled',
            failure_reason: 'Cancelled by user.',
            updated_at: Date.now(),
          })
          .eq('id', depositId)
          .eq('status', 'pending')
          .select()
          .maybeSingle();

        if (updateError) {
          console.error('[Supabase Cancel Deposit Update Error]:', updateError);
          return res.status(500).json({ error: 'Could not cancel deposit.' });
        }

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
});

// 6. PAYNECTA WEBHOOK RECEIVER (HMAC-SHA256 SIGNED WITH REPLAY PROTECTION)
// 6. PAYNECTA WEBHOOK RECEIVER (SUPABASE + ATOMIC CREDITING)
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
      event.merchant_reference ||
      event.data?.merchant_reference ||
      event.payment?.merchant_reference;

    const sessionId =
      event.session_id ||
      event.id ||
      event.data?.session_id ||
      event.data?.id;

    const providerReference =
      event.receipt_number ||
      event.data?.receipt_number ||
      event.transaction_id ||
      event.data?.transaction_id ||
      event.payment?.reference;

    if (!merchantReference && !sessionId && !providerReference) {
      return res.status(400).json({
        error: 'Missing merchant reference or session ID in webhook event.',
      });
    }

    const supabase = getSupabaseClient();

    let depositQuery = supabase.from('deposits').select('*');

    if (merchantReference) {
      depositQuery = depositQuery.eq('merchant_reference', merchantReference);
    } else if (sessionId) {
      depositQuery = depositQuery.eq('session_id', sessionId);
    } else {
      depositQuery = depositQuery.eq('provider_reference', providerReference);
    }

    const { data: deposit, error: depositError } = await depositQuery.maybeSingle();

    if (depositError) {
      console.error('[Paynecta Webhook] Supabase lookup error:', depositError);
      return res.status(500).json({ error: 'Could not locate payment record.' });
    }

    if (!deposit) {
      console.warn('[Paynecta Webhook] No matching Supabase deposit:', merchantReference || sessionId);
      return res.json({ received: true, note: 'Deposit not found.' });
    }

    const eventType = String(event.event || event.type || '').toLowerCase();

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
      eventType.includes('payment.succeeded') ||
      eventType.includes('checkout.session.completed')
    ) {
      const { data: creditResult, error: creditError } = await supabase.rpc(
        'confirm_paynecta_deposit',
        {
          p_deposit_id: deposit.id,
          p_provider_reference: providerReference || 'PAYNECTA_WEBHOOK',
          p_receipt_number: providerReference || null,
          p_confirmed_amount_kes: Number(deposit.amount_kes),
          p_source: 'webhook',
        }
      );

      if (creditError || !creditResult?.success) {
        console.error('[Paynecta Webhook] Atomic credit failed:', creditError || creditResult);
        return res.status(500).json({
          error: 'Payment received but deposit crediting needs reconciliation.',
        });
      }

      console.log(
        `[Paynecta Webhook] Deposit ${deposit.id} processed. Already credited: ${creditResult.alreadyCredited}`
      );
    } else if (
      eventStatus === 'failed' ||
      eventStatus === 'declined' ||
      eventType.includes('payment.failed')
    ) {
      const { error } = await supabase
        .from('deposits')
        .update({
          status: 'failed',
          failure_reason:
            event.failure_reason ||
            event.data?.failure_reason ||
            'Payment failed.',
          updated_at: Date.now(),
        })
        .eq('id', deposit.id)
        .neq('status', 'succeeded');

      if (error) {
        console.error('[Paynecta Webhook] Failed status update:', error);
        return res.status(500).json({ error: 'Could not update deposit status.' });
      }
    } else if (
      eventStatus === 'cancelled' ||
      eventType.includes('payment.cancelled')
    ) {
      const { error } = await supabase
        .from('deposits')
        .update({
          status: 'cancelled',
          failure_reason: 'Payment was cancelled by user.',
          updated_at: Date.now(),
        })
        .eq('id', deposit.id)
        .neq('status', 'succeeded');

      if (error) {
        console.error('[Paynecta Webhook] Cancel status update:', error);
        return res.status(500).json({ error: 'Could not update deposit status.' });
      }
    }

    return res.json({ received: true });
  } catch (err: any) {
    console.error('[Paynecta Webhook Error]:', err);
    return res.status(500).json({ error: 'Webhook processing failed.' });
  }
});

// 12. HEALTH CHECK
app.get('/api/health', (req: Request, res: Response) => {
  return res.json({ status: 'ok', service: 'DevOptions Backend', timestamp: Date.now() });
});

// Local development only. Vercel imports the Express app as a serverless function.
if (!process.env.VERCEL) {
  const startServer = async () => {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
    app.listen(Number(PORT), '0.0.0.0', () => {
      console.log(`[DevOptions] Development server listening on http://0.0.0.0:${PORT}`);
    });
  };
  startServer().catch((error) => {
    console.error('Fatal error starting DevOptions server:', error);
    process.exit(1);
  });
}
export default app;

import express, { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { paynectaService } from './src/services/paynectaService';
import { getSupabaseClient } from './src/services/supabaseService';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// CORS & Credential Support for cross-domain and secure cookies
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-auth-token, paynecta-signature, paynecta-timestamp'
  );

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
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
const DATA_DIR = path.resolve(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

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

interface DatabaseSchema {
  users: UserRecord[];
  sessions: SessionRecord[];
  trades: any[];
  deposits: DepositRecord[];
}

function loadDatabase(): DatabaseSchema {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      return {
        users: parsed.users || [],
        sessions: parsed.sessions || [],
        trades: parsed.trades || [],
        deposits: parsed.deposits || [],
      };
    }
  } catch (err) {
    console.error('Failed to load database file, initializing empty schema:', err);
  }
  return { users: [], sessions: [], trades: [], deposits: [] };
}

function saveDatabase(db: DatabaseSchema) {
  try {
    const tempFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(db, null, 2), 'utf-8');
    fs.renameSync(tempFile, DB_FILE);
  } catch (err) {
    console.error('Failed to save database file:', err);
  }
}

let db = loadDatabase();

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
// PROVISION / SEED INITIAL ADMINISTRATOR ACCOUNTS
// ─────────────────────────────────────────────────────────────
function seedAdminAccounts() {
  const defaultAdmins = [
    {
      email: 'admin@devoptions.io',
      phone: '+18005550199',
      password: 'Admin@DevOptions2026!',
      fullName: 'DevOptions Master Admin',
      country: 'Global Operations',
      demoBalance: 10000.0,
      realBalance: 0.0,
    },
    {
      email: 'francisgraham071@gmail.com',
      phone: '+12345678900',
      password: 'Admin@DevOptions2026!',
      fullName: 'Francis Graham (Admin)',
      country: 'United States',
      demoBalance: 10000.0,
      realBalance: 0.0,
    },
  ];

  let modified = false;

  for (const adm of defaultAdmins) {
    const existing = db.users.find((u) => u.email === adm.email);
    if (!existing) {
      const salt = crypto.randomBytes(16).toString('hex');
      const passwordHash = hashPassword(adm.password, salt);
      const newAdminUser: UserRecord = {
        id: `admin_${crypto.randomUUID().slice(0, 8)}`,
        email: adm.email,
        phone: adm.phone,
        passwordHash,
        salt,
        role: 'admin',
        createdAt: Date.now(),
        emailVerified: true,
        phoneVerified: true,
        demoBalance: adm.demoBalance,
        realBalance: adm.realBalance,
        fullName: adm.fullName,
        country: adm.country,
      };
      db.users.push(newAdminUser);
      modified = true;
      console.log(`[DevOptions Auth] Provisioned Administrator Account: ${adm.email} | Initial Password: ${adm.password}`);
    } else {
      let changed = false;
      if (existing.role !== 'admin') {
        existing.role = 'admin';
        changed = true;
      }
      if (!existing.emailVerified || !existing.phoneVerified) {
        existing.emailVerified = true;
        existing.phoneVerified = true;
        changed = true;
      }
      if (existing.demoBalance !== 10000.0) {
        existing.demoBalance = 10000.0;
        changed = true;
      }
      if (existing.realBalance === 50000.0) {
        existing.realBalance = 0.0;
        changed = true;
      }
      if (changed) {
        modified = true;
        console.log(`[DevOptions Auth] Synchronized administrator status for existing account: ${existing.email}`);
      }
    }
  }

  if (modified) {
    saveDatabase(db);
  }
}

// Run initial admin seeding check
seedAdminAccounts();

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

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
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

  const session = db.sessions.find((s) => s.token === token);
  if (!session) {
    return res.status(401).json({
      error: 'Invalid token',
      message: 'Authentication could not be verified.',
      code: 'INVALID_TOKEN',
    });
  }

  if (session.expiresAt < Date.now()) {
    return res.status(401).json({
      error: 'Session expired',
      message: 'Your session has expired. Please log in again.',
      code: 'SESSION_EXPIRED',
    });
  }

  const user = db.users.find((u) => u.id === session.userId);
  if (!user) {
    return res.status(401).json({
      error: 'Account inactive',
      message: 'Contact support for assistance.',
      code: 'ACCOUNT_INACTIVE',
    });
  }

  req.user = user;
  req.sessionToken = token;
  next();
}

function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
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
  (req: Request, res: Response) => {
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
        error: 'Please enter a valid phone number in international format (e.g. +14155552671 or +254712345678).',
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

    // Check duplicate account
    const existingEmail = db.users.find((u) => u.email === normEmail);
    if (existingEmail) {
      return res.status(409).json({ error: 'An account with this email address already exists.' });
    }

    const existingPhone = db.users.find((u) => u.phone === normPhone);
    if (existingPhone) {
      return res.status(409).json({ error: 'An account with this phone number already exists.' });
    }

    // Create user
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);
    const emailOtp = generateSecureOtp();
    const phoneOtp = generateSecureOtp();
    const now = Date.now();
    const otpExpiry = now + 15 * 60 * 1000; // 15 mins

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
      demoBalance: 10000.0,
      realBalance: 0.0,
      fullName: '',
      country: 'International',
    };

    // Create initial session
    const sessionToken = generateToken();
    const session: SessionRecord = {
      token: sessionToken,
      userId: newUser.id,
      createdAt: now,
      expiresAt: now + 7 * 24 * 60 * 60 * 1000, // 7 days
    };

    db.users.push(newUser);
    db.sessions.push(session);
    saveDatabase(db);
    setSessionCookie(res, sessionToken);

    console.log(`[DevOptions Auth] New User Registered: ${normEmail} | Email OTP: ${emailOtp} | Phone OTP: ${phoneOtp}`);

    return res.status(201).json({
      message: 'Account registered successfully. Please verify your contact details.',
      token: sessionToken,
      user: safeUserResponse(newUser, emailOtp, phoneOtp),
    });
  }
);

// 2. LOGIN
app.post(
  '/api/auth/login',
  rateLimitMiddleware(15, 60000),
  (req: Request, res: Response) => {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Email/Phone and password are required.' });
    }

    const trimmed = identifier.trim();
    const isEmail = trimmed.includes('@');
    const normIdentifier = isEmail ? normalizeEmail(trimmed) : normalizePhone(trimmed);

    const user = db.users.find((u) => (isEmail ? u.email === normIdentifier : u.phone === normIdentifier));
    if (!user) {
      return res.status(401).json({ error: 'Invalid email, phone, or password.' });
    }

    const valid = verifyPassword(password, user.salt, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email, phone, or password.' });
    }

    const sessionToken = generateToken();
    const now = Date.now();
    const session: SessionRecord = {
      token: sessionToken,
      userId: user.id,
      createdAt: now,
      expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    };

    db.sessions.push(session);
    saveDatabase(db);
    setSessionCookie(res, sessionToken);

    console.log(`[DevOptions Auth] User Logged In: ${user.email}`);

    return res.json({
      message: 'Logged in successfully.',
      token: sessionToken,
      user: safeUserResponse(user),
    });
  }
);

// 3. LOGOUT
app.post('/api/auth/logout', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const token = req.sessionToken;
  db.sessions = db.sessions.filter((s) => s.token !== token);
  saveDatabase(db);
  clearSessionCookie(res);
  return res.json({ message: 'Logged out successfully.' });
});

// 4. GET CURRENT USER (SESSION VERIFICATION)
app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  return res.json({
    user: safeUserResponse(req.user!),
  });
});

// 5. VERIFY EMAIL
app.post('/api/auth/verify-email', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const { code } = req.body;
  const user = req.user!;

  if (user.emailVerified) {
    return res.json({ message: 'Email is already verified.', user: safeUserResponse(user) });
  }

  if (!code || !user.emailVerificationCode) {
    return res.status(400).json({ error: 'Please enter the 6-digit email verification code.' });
  }

  if (user.emailVerificationExpires && user.emailVerificationExpires < Date.now()) {
    return res.status(400).json({ error: 'Verification code has expired. Please request a new one.' });
  }

  if (user.emailVerificationCode !== code.trim()) {
    return res.status(400).json({ error: 'Invalid email verification code. Please check and retry.' });
  }

  user.emailVerified = true;
  user.emailVerificationCode = undefined;
  user.emailVerificationExpires = undefined;
  saveDatabase(db);

  console.log(`[DevOptions Auth] Email Verified for user: ${user.email}`);
  return res.json({ message: 'Email verified successfully!', user: safeUserResponse(user) });
});

// 6. VERIFY PHONE
app.post('/api/auth/verify-phone', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const { code } = req.body;
  const user = req.user!;

  if (user.phoneVerified) {
    return res.json({ message: 'Phone number is already verified.', user: safeUserResponse(user) });
  }

  if (!code || !user.phoneVerificationCode) {
    return res.status(400).json({ error: 'Please enter the 6-digit phone verification code.' });
  }

  if (user.phoneVerificationExpires && user.phoneVerificationExpires < Date.now()) {
    return res.status(400).json({ error: 'Verification code has expired. Please request a new one.' });
  }

  if (user.phoneVerificationCode !== code.trim()) {
    return res.status(400).json({ error: 'Invalid phone verification code. Please check and retry.' });
  }

  user.phoneVerified = true;
  user.phoneVerificationCode = undefined;
  user.phoneVerificationExpires = undefined;
  saveDatabase(db);

  console.log(`[DevOptions Auth] Phone Verified for user: ${user.phone}`);
  return res.json({ message: 'Phone number verified successfully!', user: safeUserResponse(user) });
});

// 7. RESEND VERIFICATION CODE
app.post('/api/auth/resend-code', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const { type } = req.body; // 'email' | 'phone'
  const user = req.user!;
  const newOtp = generateSecureOtp();
  const now = Date.now();
  const expiry = now + 15 * 60 * 1000;

  if (type === 'phone') {
    if (user.phoneVerified) {
      return res.status(400).json({ error: 'Phone number is already verified.' });
    }
    user.phoneVerificationCode = newOtp;
    user.phoneVerificationExpires = expiry;
    saveDatabase(db);
    console.log(`[DevOptions Auth] Resent Phone OTP for ${user.phone}: ${newOtp}`);
    return res.json({
      message: 'New phone verification code generated.',
      user: safeUserResponse(user, undefined, newOtp),
    });
  } else {
    if (user.emailVerified) {
      return res.status(400).json({ error: 'Email is already verified.' });
    }
    user.emailVerificationCode = newOtp;
    user.emailVerificationExpires = expiry;
    saveDatabase(db);
    console.log(`[DevOptions Auth] Resent Email OTP for ${user.email}: ${newOtp}`);
    return res.json({
      message: 'New email verification code generated.',
      user: safeUserResponse(user, newOtp, undefined),
    });
  }
});

// 8. FORGOT PASSWORD (REQUEST RESET CODE)
app.post(
  '/api/auth/forgot-password',
  rateLimitMiddleware(5, 60000),
  (req: Request, res: Response) => {
    const { identifier } = req.body;
    if (!identifier) {
      return res.status(400).json({ error: 'Please provide your registered email or phone number.' });
    }

    const trimmed = identifier.trim();
    const isEmail = trimmed.includes('@');
    const norm = isEmail ? normalizeEmail(trimmed) : normalizePhone(trimmed);

    const user = db.users.find((u) => (isEmail ? u.email === norm : u.phone === norm));
    if (!user) {
      // Avoid account enumeration: always return generic message
      return res.json({
        message: 'If an account matches that contact method, a verification code has been dispatched.',
      });
    }

    const resetOtp = generateSecureOtp();
    user.resetPasswordToken = resetOtp;
    user.resetPasswordExpires = Date.now() + 30 * 60 * 1000; // 30 minutes
    saveDatabase(db);

    console.log(`[DevOptions Auth] Password Reset Code for ${user.email}: ${resetOtp}`);

    return res.json({
      message: 'If an account matches that contact method, a verification code has been dispatched.',
      devOtp: resetOtp, // For smooth dev testing
    });
  }
);

// 9. RESET PASSWORD (SUBMIT RESET)
app.post(
  '/api/auth/reset-password',
  rateLimitMiddleware(10, 60000),
  (req: Request, res: Response) => {
    const { identifier, code, newPassword, confirmPassword } = req.body;

    if (!identifier || !code || !newPassword) {
      return res.status(400).json({ error: 'All fields are required.' });
    }

    const passCheck = validatePasswordSecurity(newPassword);
    if (!passCheck.isValid) {
      return res.status(400).json({ error: passCheck.message });
    }

    if (confirmPassword && newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }

    const trimmed = identifier.trim();
    const isEmail = trimmed.includes('@');
    const norm = isEmail ? normalizeEmail(trimmed) : normalizePhone(trimmed);

    const user = db.users.find((u) => (isEmail ? u.email === norm : u.phone === norm));
    if (
      !user ||
      !user.resetPasswordToken ||
      user.resetPasswordToken !== code.trim() ||
      (user.resetPasswordExpires && user.resetPasswordExpires < Date.now())
    ) {
      return res.status(400).json({ error: 'Invalid or expired password reset code.' });
    }

    // Hash new password
    const salt = crypto.randomBytes(16).toString('hex');
    user.salt = salt;
    user.passwordHash = hashPassword(newPassword, salt);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    // Invalidate existing sessions for security
    db.sessions = db.sessions.filter((s) => s.userId !== user.id);
    saveDatabase(db);

    console.log(`[DevOptions Auth] Password successfully reset for ${user.email}`);

    return res.json({ message: 'Password has been reset successfully. Please log in with your new password.' });
  }
);

// 10. UPDATE PROFILE
app.put('/api/user/profile', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const { fullName, country, soundEnabled, theme } = req.body;
  const user = req.user!;

  if (fullName !== undefined) user.fullName = String(fullName).trim();
  if (country !== undefined) user.country = String(country).trim();
  if (soundEnabled !== undefined) user.soundEnabled = Boolean(soundEnabled);
  if (theme !== undefined) user.theme = String(theme).trim();

  saveDatabase(db);
  return res.json({ message: 'Profile updated.', user: safeUserResponse(user) });
});

// 11. USER TRADES PERSISTENCE
app.get('/api/user/trades', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userTrades = db.trades.filter((t) => t.userId === req.user!.id);
  return res.json({ trades: userTrades.slice(0, 50) });
});

app.post('/api/user/trades', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const trade = req.body;
  if (!trade || !trade.id) {
    return res.status(400).json({ error: 'Invalid trade payload' });
  }

  trade.userId = req.user!.id;
  trade.recordedAt = Date.now();
  db.trades.unshift(trade);
  if (db.trades.length > 500) {
    db.trades = db.trades.slice(0, 500);
  }
  saveDatabase(db);
  return res.status(201).json({ message: 'Trade saved', trade });
});

// ─────────────────────────────────────────────────────────────
// ADMINISTRATOR API ROUTES
// ─────────────────────────────────────────────────────────────

// 1. ADMIN OVERVIEW & METRICS
app.get('/api/admin/overview', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const totalUsers = db.users.length;
  const verifiedUsers = db.users.filter((u) => u.emailVerified && u.phoneVerified).length;
  const activeSessions = db.sessions.filter((s) => s.expiresAt > Date.now()).length;
  const totalTrades = db.trades.length;
  const totalVolume = db.trades.reduce((acc, t) => acc + (Number(t.stake) || 0), 0);
  const netProfitLoss = db.trades.reduce((acc, t) => acc + (Number(t.profit) || 0), 0);
  const adminsCount = db.users.filter((u) => u.role === 'admin').length;

  return res.json({
    metrics: {
      totalUsers,
      verifiedUsers,
      activeSessions,
      totalTrades,
      totalVolume: Number(totalVolume.toFixed(2)),
      netProfitLoss: Number(netProfitLoss.toFixed(2)),
      adminsCount,
    },
    defaultAccounts: [
      {
        email: 'admin@devoptions.io',
        role: 'admin',
        description: 'System Master Administrator Account',
      },
      {
        email: 'francisgraham071@gmail.com',
        role: 'admin',
        description: 'Primary Platform Administrator Account',
      },
    ],
  });
});

// 2. ADMIN USERS DIRECTORY
app.get('/api/admin/users', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const sanitizedUsers = db.users.map((u) => ({
    id: u.id,
    email: u.email,
    phone: u.phone,
    role: u.role || 'user',
    emailVerified: u.emailVerified,
    phoneVerified: u.phoneVerified,
    demoBalance: u.demoBalance,
    realBalance: u.realBalance,
    fullName: u.fullName || '',
    country: u.country || 'International',
    createdAt: u.createdAt,
  }));

  return res.json({ users: sanitizedUsers });
});

// 3. ADMIN CHANGE USER ROLE
app.post('/api/admin/users/:id/role', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const targetId = req.params.id;
  const { role } = req.body;

  if (role !== 'admin' && role !== 'user') {
    return res.status(400).json({ error: 'Role must be either "admin" or "user".' });
  }

  const targetUser = db.users.find((u) => u.id === targetId);
  if (!targetUser) {
    return res.status(404).json({ error: 'Target user not found.' });
  }

  // Prevent demoting the last admin
  if (targetUser.role === 'admin' && role === 'user') {
    const adminCount = db.users.filter((u) => u.role === 'admin').length;
    if (adminCount <= 1) {
      return res.status(400).json({ error: 'Cannot demote the last remaining administrator.' });
    }
  }

  targetUser.role = role;
  saveDatabase(db);

  return res.json({
    message: `User ${targetUser.email} role updated to ${role}.`,
    user: safeUserResponse(targetUser),
  });
});

// 4. ADMIN ADJUST USER BALANCE
app.post('/api/admin/users/:id/balance', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const targetId = req.params.id;
  const { accountType, amount, operation } = req.body;

  const targetUser = db.users.find((u) => u.id === targetId);
  if (!targetUser) {
    return res.status(404).json({ error: 'Target user not found.' });
  }

  const numAmount = Number(amount);
  if (isNaN(numAmount) || numAmount < 0) {
    return res.status(400).json({ error: 'Please specify a valid positive numerical amount.' });
  }

  if (accountType === 'real') {
    if (operation === 'set') {
      targetUser.realBalance = numAmount;
    } else {
      targetUser.realBalance = Math.max(0, targetUser.realBalance + numAmount);
    }
  } else {
    // default to demo
    if (operation === 'set') {
      targetUser.demoBalance = numAmount;
    } else {
      targetUser.demoBalance = Math.max(0, targetUser.demoBalance + numAmount);
    }
  }

  saveDatabase(db);
  return res.json({
    message: `Account balance updated for ${targetUser.email}.`,
    user: safeUserResponse(targetUser),
  });
});

// 5. ADMIN CREATE ADMIN ACCOUNT
app.post('/api/admin/create-admin', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const { email, phone, password, fullName } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const normEmail = normalizeEmail(email);
  const normPhone = phone ? normalizePhone(phone) : '+18005550199';

  const existing = db.users.find((u) => u.email === normEmail);
  if (existing) {
    existing.role = 'admin';
    existing.emailVerified = true;
    existing.phoneVerified = true;
    saveDatabase(db);
    return res.json({ message: `Existing user ${normEmail} promoted to administrator.`, user: safeUserResponse(existing) });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  const newAdmin: UserRecord = {
    id: `admin_${crypto.randomUUID().slice(0, 8)}`,
    email: normEmail,
    phone: normPhone,
    passwordHash,
    salt,
    role: 'admin',
    createdAt: Date.now(),
    emailVerified: true,
    phoneVerified: true,
    demoBalance: 10000.0,
    realBalance: 0.0,
    fullName: fullName || 'DevOptions Administrator',
    country: 'International',
  };

  db.users.push(newAdmin);
  saveDatabase(db);

  return res.status(201).json({
    message: 'New administrator account created successfully.',
    user: safeUserResponse(newAdmin),
  });
});

// 6. ADMIN DELETE USER
app.delete('/api/admin/users/:id', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const targetId = req.params.id;

  if (req.user?.id === targetId) {
    return res.status(400).json({ error: 'Administrators cannot delete their own active account.' });
  }

  const userIndex = db.users.findIndex((u) => u.id === targetId);
  if (userIndex === -1) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const deletedUser = db.users[userIndex];
  db.users.splice(userIndex, 1);
  db.sessions = db.sessions.filter((s) => s.userId !== targetId);
  saveDatabase(db);

  return res.json({ message: `User ${deletedUser.email} has been deleted.` });
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
app.post(
  '/api/paynecta/verify-deposit/:id',
  requireAuth,
  rateLimitMiddleware(30, 60000),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const depositId = req.params.id;
      const user = req.user!;

      if (!db.deposits) db.deposits = [];
      const deposit = db.deposits.find((d) => d.id === depositId);

      if (!deposit) {
        return res.status(404).json({ error: 'Deposit record not found.' });
      }

      if (deposit.userId !== user.id && user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied: deposit belongs to another user.' });
      }

      // IDEMPOTENCY CHECK: If already confirmed, return success without duplicate crediting
      if (deposit.status === 'succeeded') {
        const currentUser = db.users.find((u) => u.id === deposit.userId) || user;
        return res.json({
          status: 'succeeded',
          alreadyCredited: true,
          deposit,
          realBalance: currentUser.realBalance,
          message: 'Deposit already confirmed and credited to balance.',
        });
      }

      // Perform server-to-server verification with Paynecta API
      const verification = await paynectaService.verifyCheckoutSession(
        deposit.sessionId || '',
        deposit.merchantReference
      );

      deposit.updatedAt = Date.now();

      if (verification.status === 'succeeded') {
        // Prevent concurrent double crediting if already marked by webhook
        const freshRecord = db.deposits?.find((d) => d.id === depositId);
        if (freshRecord && freshRecord.status === 'succeeded') {
          const currentUser = db.users.find((u) => u.id === deposit.userId) || user;
          return res.json({
            status: 'succeeded',
            alreadyCredited: true,
            deposit: freshRecord,
            realBalance: currentUser.realBalance,
            message: 'Deposit already confirmed and credited to balance.',
          });
        }

        deposit.status = 'succeeded';
        deposit.confirmedAmountKes = verification.confirmedAmountKes || deposit.amountKes;
        deposit.providerReference =
          verification.providerReference || verification.receiptNumber || 'PAYNECTA_VERIFIED';
        deposit.receiptNumber = verification.receiptNumber || verification.providerReference;
        deposit.confirmedAt = Date.now();

        // Atomically update user's platform balance
        const targetUser = db.users.find((u) => u.id === deposit.userId);
        if (targetUser) {
          targetUser.realBalance = Number((targetUser.realBalance + deposit.amountUsd).toFixed(2));
        }

        // Add ledger record
        const txRecord = {
          id: `tx_${deposit.id}`,
          userId: deposit.userId,
          type: 'deposit',
          method: 'mpesa',
          amountUSD: deposit.amountUsd,
          amountLocal: deposit.amountKes,
          localCurrency: 'KES',
          feeUSD: 0,
          netAmountUSD: deposit.amountUsd,
          status: 'completed',
          reference: deposit.providerReference || deposit.merchantReference,
          createdAt: Date.now(),
          details: {
            merchantReference: deposit.merchantReference,
            providerReceipt: deposit.receiptNumber,
            gateway: 'Paynecta M-Pesa',
          },
        };

        if (!db.trades) db.trades = [];
        db.trades.push(txRecord);

        saveDatabase(db);

        return res.json({
          status: 'succeeded',
          deposit,
          realBalance: targetUser?.realBalance ?? user.realBalance,
          message: `Payment confirmed! KES ${deposit.amountKes.toLocaleString()} received. Real balance credited with +$${deposit.amountUsd.toFixed(2)} USD.`,
        });
      }

      if (verification.status === 'failed') {
        deposit.status = 'failed';
        deposit.failureReason = verification.failureReason || 'Payment declined or refused by provider.';
        saveDatabase(db);

        return res.json({
          status: 'failed',
          deposit,
          message: deposit.failureReason,
        });
      }

      if (verification.status === 'cancelled') {
        deposit.status = 'cancelled';
        deposit.failureReason = verification.failureReason || 'Payment was cancelled.';
        saveDatabase(db);

        return res.json({
          status: 'cancelled',
          deposit,
          message: 'Payment was cancelled.',
        });
      }

      if (verification.status === 'verification_delayed') {
        return res.json({
          status: 'verification_delayed',
          deposit,
          message:
            verification.failureReason ||
            'Verification is delayed. Paynecta is reconciling settlement with network.',
        });
      }

      // Default: Still awaiting payment
      return res.json({
        status: 'pending',
        deposit,
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
app.post('/api/paynecta/cancel-deposit/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const depositId = req.params.id;
  const user = req.user!;

  if (!db.deposits) db.deposits = [];
  const deposit = db.deposits.find((d) => d.id === depositId);

  if (!deposit) {
    return res.status(404).json({ error: 'Deposit record not found.' });
  }

  if (deposit.userId !== user.id && user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied.' });
  }

  if (deposit.status === 'pending') {
    deposit.status = 'cancelled';
    deposit.failureReason = 'Cancelled by user.';
    deposit.updatedAt = Date.now();
    saveDatabase(db);
  }

  return res.json({ message: 'Deposit marked as cancelled.', deposit });
});

// 6. PAYNECTA WEBHOOK RECEIVER (HMAC-SHA256 SIGNED WITH REPLAY PROTECTION)
app.post('/api/paynecta/webhook', (req: Request, res: Response) => {
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
  // If webhook secret is configured, enforce strict verification
  if (config.webhookSecret && !verification.isValid) {
    console.warn('[Paynecta Webhook] Verification failed:', verification.reason);
    return res.status(401).json({
      error: 'Invalid webhook signature or expired timestamp.',
      reason: verification.reason,
    });
  }

  const event = req.body;
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
    return res.status(400).json({ error: 'Missing merchant reference or session ID in webhook event.' });
  }

  if (!db.deposits) db.deposits = [];
  const deposit = db.deposits.find(
    (d) =>
      (merchantReference && d.merchantReference === merchantReference) ||
      (sessionId && d.sessionId === sessionId) ||
      (providerReference && d.providerReference === providerReference)
  );

  if (!deposit) {
    console.warn('[Paynecta Webhook] No matching deposit for reference:', merchantReference || sessionId);
    return res.json({ received: true, note: 'Deposit not found in local records' });
  }

  const eventType = String(event.event || event.type || '').toLowerCase();
  const eventStatus = String(
    event.status ||
    event.data?.status ||
    event.payment?.status ||
    ''
  ).toLowerCase();

  // 1. PAYMENT SUCCEEDED (CREDIT USER IDEMPOTENTLY)
  if (
    eventStatus === 'succeeded' ||
    eventStatus === 'completed' ||
    eventStatus === 'paid' ||
    eventType.includes('payment.succeeded') ||
    eventType.includes('checkout.session.completed')
  ) {
    if (deposit.status !== 'succeeded') {
      deposit.status = 'succeeded';
      deposit.confirmedAmountKes = deposit.amountKes;
      deposit.providerReference = providerReference || 'PAYNECTA_WEBHOOK';
      deposit.receiptNumber = providerReference;
      deposit.confirmedAt = Date.now();
      deposit.updatedAt = Date.now();

      const targetUser = db.users.find((u) => u.id === deposit.userId);
      if (targetUser) {
        targetUser.realBalance = Number((targetUser.realBalance + deposit.amountUsd).toFixed(2));
      }

      // Record in ledger
      const txRecord = {
        id: `tx_${deposit.id}`,
        userId: deposit.userId,
        type: 'deposit',
        method: 'mpesa',
        amountUSD: deposit.amountUsd,
        amountLocal: deposit.amountKes,
        localCurrency: 'KES',
        feeUSD: 0,
        netAmountUSD: deposit.amountUsd,
        status: 'completed',
        reference: deposit.providerReference || deposit.merchantReference,
        createdAt: Date.now(),
        details: {
          merchantReference: deposit.merchantReference,
          providerReceipt: deposit.receiptNumber,
          gateway: 'Paynecta M-Pesa',
          source: 'webhook',
        },
      };

      if (!db.trades) db.trades = [];
      db.trades.push(txRecord);

      saveDatabase(db);
      console.log(`[Paynecta Webhook] Successfully credited deposit ${deposit.id} for user ${deposit.userId}`);
    }
  } else if (
    eventStatus === 'failed' ||
    eventStatus === 'declined' ||
    eventType.includes('payment.failed')
  ) {
    deposit.status = 'failed';
    deposit.failureReason = event.failure_reason || event.data?.failure_reason || 'Payment failed.';
    deposit.updatedAt = Date.now();
    saveDatabase(db);
  } else if (
    eventStatus === 'cancelled' ||
    eventType.includes('payment.cancelled')
  ) {
    deposit.status = 'cancelled';
    deposit.failureReason = 'Payment was cancelled by user.';
    deposit.updatedAt = Date.now();
    saveDatabase(db);
  }

  return res.json({ received: true });
});

// 12. HEALTH CHECK
app.get('/api/health', (req: Request, res: Response) => {
  return res.json({ status: 'ok', service: 'DevOptions Backend', timestamp: Date.now() });
});

// ─────────────────────────────────────────────────────────────
// VITE DEV SERVER OR STATIC PRODUCTION SERVING
// ─────────────────────────────────────────────────────────────
async function startServer() {
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`[DevOptions] Server listening on http://0.0.0.0:${PORT} (mode: ${isDev ? 'dev' : 'prod'})`);
  });
}

startServer().catch((err) => {
  console.error('Fatal error starting DevOptions server:', err);
  process.exit(1);
});

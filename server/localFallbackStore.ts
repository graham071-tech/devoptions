import fs from 'fs';
import path from 'path';

export interface LocalUserRow {
  id: string;
  email: string;
  phone: string;
  password_hash: string;
  salt: string;
  role: 'admin' | 'user';
  created_at: number;
  email_verified: boolean;
  phone_verified: boolean;
  email_verification_code?: string | null;
  email_verification_expires?: number | null;
  phone_verification_code?: string | null;
  phone_verification_expires?: number | null;
  reset_password_token?: string | null;
  reset_password_expires?: number | null;
  demo_balance: number;
  real_balance: number;
  full_name?: string | null;
  country?: string | null;
  theme?: string | null;
  sound_enabled?: boolean | null;
  token_valid_after?: number | null;
}

export interface LocalSessionRow {
  token: string;
  user_id: string;
  created_at: number;
  expires_at: number;
}

export interface LocalRevokedTokenRow {
  sid: string;
  exp: number;
}

export interface LocalTradeRow {
  id: string;
  user_id: string;
  trade_data: any;
  recorded_at: number;
}

export interface LocalDepositRow {
  id: string;
  user_id: string;
  merchant_reference: string;
  amount_kes: number;
  amount_subunits: number;
  amount_usd: number;
  currency: 'KES';
  session_id?: string | null;
  checkout_url?: string | null;
  provider_reference?: string | null;
  receipt_number?: string | null;
  status: string;
  failure_reason?: string | null;
  confirmed_amount_kes?: number | null;
  created_at: number;
  updated_at: number;
  confirmed_at?: number | null;
}

interface LocalDatabase {
  users: LocalUserRow[];
  sessions: LocalSessionRow[];
  trades: LocalTradeRow[];
  deposits: LocalDepositRow[];
  revoked_tokens: LocalRevokedTokenRow[];
}

function resolveDbPath(): string {
  const preferredDir = path.resolve(process.cwd(), 'data');
  try {
    if (!fs.existsSync(preferredDir)) {
      fs.mkdirSync(preferredDir, { recursive: true });
    }
    const probe = path.join(preferredDir, '.write-probe');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return path.join(preferredDir, 'db.json');
  } catch {
    return path.join('/tmp', 'devoptions-db.json');
  }
}

const DB_FILE = resolveDbPath();

export const LEGACY_PROTECTED_ADMIN_PASSWORD_HASH =
  'c92cc65720b3f407240df88c8e72adc04ebb614934a1a40d4b19a7b1d242cf8978bffb9a52204f67497d8777f2b4a12aebd140917c521880e6922ca74ff21f7c';

export const SEEDED_ADMINS: LocalUserRow[] = [
  {
    id: 'admin_4f5a945e',
    email: 'admin@devoptions.io',
    phone: '+18005550199',
    salt: '8c51721f58f5edf93065ce8dd6ea72a9',
    password_hash:
      '7c1f764c8215ef72fe8f2b202fc3bbf41d0e0b431c905c3f7246377225cfacecfc9b889fe47b9a1099aaf623763e9188dec348f9925383fec9b8c45f5e4eb2d4',
    role: 'admin',
    created_at: 1793259641336,
    email_verified: true,
    phone_verified: true,
    demo_balance: 10000,
    real_balance: 0,
    full_name: 'DevOptions Master Admin',
    country: 'Global Operations',
  },
  {
    id: 'admin_8bb442bc',
    email: 'francisgraham071@gmail.com',
    phone: '+12345678900',
    salt: '393aba61d961b960642589585d4b7199',
    password_hash:
      '3212a78395cf7cac27f19cbd7edf612d2358019ea76eaf5da1d1a62eebbc13c1c1b3d548602ce3346c07fd08f717a6cf7c33d759895e1601ab8b2e9dde46e4d5',
    role: 'admin',
    created_at: 1793259641402,
    email_verified: true,
    phone_verified: true,
    demo_balance: 10000,
    real_balance: 0,
    full_name: 'Francis Graham (Admin)',
    country: 'United States',
  },
];

function loadDb(): LocalDatabase {
  const now = Date.now();
  let db: LocalDatabase = { users: [], sessions: [], trades: [], deposits: [], revoked_tokens: [] };
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      db = {
        users: Array.isArray(parsed.users) ? parsed.users : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        trades: Array.isArray(parsed.trades) ? parsed.trades : [],
        deposits: Array.isArray(parsed.deposits) ? parsed.deposits : [],
        revoked_tokens: Array.isArray(parsed.revoked_tokens) ? parsed.revoked_tokens : [],
      };
    }
  } catch (err) {
    console.warn('[LocalFallbackStore] Failed to load existing DB file, initializing fresh store.');
  }

  let modified = false;

  // Prune expired sessions and expired revocations so db.json stays lean
  const activeSessions = db.sessions.filter((s) => Number(s.expires_at) > now);
  if (activeSessions.length !== db.sessions.length) {
    db.sessions = activeSessions;
    modified = true;
  }
  const activeRevocations = db.revoked_tokens.filter((r) => Number(r.exp) > now);
  if (activeRevocations.length !== db.revoked_tokens.length) {
    db.revoked_tokens = activeRevocations;
    modified = true;
  }

  for (const adm of SEEDED_ADMINS) {
    const existing = db.users.find((u) => u.email.toLowerCase() === adm.email.toLowerCase());
    if (!existing) {
      db.users.push({ ...adm });
      modified = true;
    } else {
      if (existing.role !== 'admin') {
        existing.role = 'admin';
        existing.email_verified = true;
        existing.phone_verified = true;
        modified = true;
      }
      if (
        adm.email.toLowerCase() === 'francisgraham071@gmail.com' &&
        existing.password_hash === LEGACY_PROTECTED_ADMIN_PASSWORD_HASH
      ) {
        existing.salt = adm.salt;
        existing.password_hash = adm.password_hash;
        existing.token_valid_after = now;
        db.sessions = db.sessions.filter((s) => s.user_id !== existing.id);
        modified = true;
      }
    }
  }

  if (modified) {
    saveDb(db);
  }
  return db;
}

function saveDb(db: LocalDatabase): void {
  try {
    const tmp = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf-8');
    fs.renameSync(tmp, DB_FILE);
  } catch (err) {
    console.error('[LocalFallbackStore] Failed to persist DB file:', err);
  }
}

let cachedDb: LocalDatabase = loadDb();

function getDb(): LocalDatabase {
  return cachedDb;
}

export const localFallbackStore = {
  // Users
  findUserByEmail(email: string): LocalUserRow | null {
    const target = email.trim().toLowerCase();
    return getDb().users.find((u) => u.email.toLowerCase() === target) || null;
  },

  findUserByPhone(phone: string): LocalUserRow | null {
    return getDb().users.find((u) => u.phone === phone) || null;
  },

  findUserById(id: string): LocalUserRow | null {
    return getDb().users.find((u) => u.id === id) || null;
  },

  insertUser(row: LocalUserRow): { error?: { code?: string; message: string } } {
    const db = getDb();
    const targetEmail = row.email.trim().toLowerCase();
    if (db.users.some((u) => u.email.toLowerCase() === targetEmail || u.phone === row.phone)) {
      return {
        error: {
          code: '23505',
          message: 'An account with this email address or phone number already exists.',
        },
      };
    }
    db.users.push({ ...row, email: targetEmail });
    saveDb(db);
    return {};
  },

  updateUser(id: string, patch: Partial<LocalUserRow>): LocalUserRow | null {
    const db = getDb();
    const user = db.users.find((u) => u.id === id);
    if (!user) return null;
    Object.assign(user, patch);
    saveDb(db);
    return { ...user };
  },

  deleteUser(id: string): void {
    const db = getDb();
    db.users = db.users.filter((u) => u.id !== id);
    db.sessions = db.sessions.filter((s) => s.user_id !== id);
    saveDb(db);
  },

  listUsers(): LocalUserRow[] {
    return [...getDb().users].sort((a, b) => Number(b.created_at) - Number(a.created_at));
  },

  // Sessions
  findSession(token: string): LocalSessionRow | null {
    return getDb().sessions.find((s) => s.token === token) || null;
  },

  insertSession(row: LocalSessionRow): void {
    const db = getDb();
    const now = Date.now();
    db.sessions = db.sessions.filter((s) => Number(s.expires_at) > now);
    db.sessions.push({ ...row });
    saveDb(db);
  },

  deleteSession(token: string): void {
    const db = getDb();
    db.sessions = db.sessions.filter((s) => s.token !== token);
    saveDb(db);
  },

  deleteSessionsByUser(userId: string): void {
    const db = getDb();
    db.sessions = db.sessions.filter((s) => s.user_id !== userId);
    saveDb(db);
  },

  revokeSessionId(sid: string, exp: number): void {
    if (!sid) return;
    const db = getDb();
    const now = Date.now();
    db.revoked_tokens = db.revoked_tokens.filter((r) => Number(r.exp) > now && r.sid !== sid);
    if (exp > now) {
      db.revoked_tokens.push({ sid, exp });
    }
    saveDb(db);
  },

  isSessionIdRevoked(sid: string): boolean {
    if (!sid) return false;
    const now = Date.now();
    return getDb().revoked_tokens.some((r) => r.sid === sid && Number(r.exp) > now);
  },

  countActiveSessions(now: number): number {
    return getDb().sessions.filter((s) => Number(s.expires_at) > now).length;
  },

  // Trades
  listTradesByUser(userId: string, limit = 50): any[] {
    return getDb()
      .trades.filter((t) => t.user_id === userId)
      .sort((a, b) => Number(b.recorded_at) - Number(a.recorded_at))
      .slice(0, limit)
      .map((t) => t.trade_data);
  },

  listAllTrades(): any[] {
    return getDb().trades.map((t) => t.trade_data);
  },

  insertTrade(row: LocalTradeRow): void {
    const db = getDb();
    db.trades.unshift({ ...row });
    if (db.trades.length > 500) {
      db.trades = db.trades.slice(0, 500);
    }
    saveDb(db);
  },

  placeSimulatedTrade(
    userId: string,
    trade: any,
    mode: 'demo' | 'real',
    stake: number
  ): { balance: number; mode: string } {
    const db = getDb();
    if (mode === 'real') {
      throw new Error('Real-account order execution requires server-verified market outcomes');
    }
    const user = db.users.find((u) => u.id === userId);
    if (!user) throw new Error('Account not found');
    if (db.trades.some((t) => t.id === String(trade.id))) {
      throw new Error('Trade already exists');
    }
    const current = Number(user.demo_balance || 0);
    if (current < stake) {
      throw new Error('Insufficient balance');
    }
    const nextBalance = Number((current - stake).toFixed(2));
    user.demo_balance = nextBalance;
    const now = Date.now();
    db.trades.unshift({
      id: String(trade.id),
      user_id: userId,
      trade_data: { ...trade, userId, recordedAt: now },
      recorded_at: now,
    });
    saveDb(db);
    return { balance: nextBalance, mode };
  },

  settleSimulatedTrade(
    userId: string,
    tradeId: string,
    settlement: any
  ): { balance: number; mode: string } {
    const db = getDb();
    const row = db.trades.find((t) => t.id === tradeId && t.user_id === userId);
    if (!row) throw new Error('Trade not found');
    if (row.trade_data?.status !== 'active') {
      throw new Error('Trade already settled');
    }
    const mode = row.trade_data?.mode;
    const payout = Number(row.trade_data?.potentialPayout || 0);
    if (mode === 'real') {
      throw new Error('Real-account order execution requires server-verified market outcomes');
    }
    const user = db.users.find((u) => u.id === userId);
    if (!user) throw new Error('Account not found');
    if (settlement.status === 'won') {
      user.demo_balance = Number((Number(user.demo_balance || 0) + payout).toFixed(2));
    }
    const now = Date.now();
    row.trade_data = { ...row.trade_data, ...settlement, settledAt: now };
    row.recorded_at = now;
    saveDb(db);
    return { balance: Number(user.demo_balance), mode };
  },

  // Deposits
  insertDeposit(row: LocalDepositRow): void {
    const db = getDb();
    db.deposits.unshift({ ...row });
    saveDb(db);
  },

  listDepositsByUser(userId: string, limit = 50): LocalDepositRow[] {
    return getDb()
      .deposits.filter((d) => d.user_id === userId)
      .sort((a, b) => Number(b.created_at) - Number(a.created_at))
      .slice(0, limit);
  },

  countDepositsByUser(userId: string): number {
    return getDb().deposits.filter((d) => d.user_id === userId).length;
  },

  findDepositById(id: string): LocalDepositRow | null {
    return getDb().deposits.find((d) => d.id === id) || null;
  },

  findDepositByLookup(opts: {
    merchantReference?: string;
    sessionId?: string;
    providerReference?: string;
  }): LocalDepositRow | null {
    const deposits = getDb().deposits;
    if (opts.merchantReference) {
      return deposits.find((d) => d.merchant_reference === opts.merchantReference) || null;
    }
    if (opts.sessionId) {
      return deposits.find((d) => d.session_id === opts.sessionId) || null;
    }
    if (opts.providerReference) {
      return deposits.find((d) => d.provider_reference === opts.providerReference) || null;
    }
    return null;
  },

  updateDeposit(
    id: string,
    patch: Partial<LocalDepositRow>,
    options?: { neqStatus?: string; eqStatus?: string }
  ): LocalDepositRow | null {
    const db = getDb();
    const dep = db.deposits.find((d) => d.id === id);
    if (!dep) return null;
    if (options?.neqStatus && dep.status === options.neqStatus) return null;
    if (options?.eqStatus && dep.status !== options.eqStatus) return null;
    Object.assign(dep, patch);
    saveDb(db);
    return { ...dep };
  },

  confirmDeposit(params: {
    depositId: string;
    providerReference: string;
    receiptNumber: string | null;
    confirmedAmountKes: number;
  }): { success: boolean; alreadyCredited?: boolean; realBalance?: number; error?: string } {
    const db = getDb();
    const dep = db.deposits.find((d) => d.id === params.depositId);
    if (!dep) return { success: false, error: 'Deposit not found.' };
    const user = db.users.find((u) => u.id === dep.user_id);
    if (!user) return { success: false, error: 'Deposit account not found.' };

    if (dep.status === 'succeeded') {
      return {
        success: true,
        alreadyCredited: true,
        realBalance: Number(user.real_balance),
      };
    }
    if (dep.status !== 'pending') {
      return { success: false, error: 'Deposit is not pending.' };
    }
    if (
      Math.round(params.confirmedAmountKes * 100) !== Math.round(dep.amount_kes * 100) ||
      dep.currency !== 'KES' ||
      dep.amount_usd <= 0
    ) {
      return {
        success: false,
        error: 'Confirmed payment amount or currency does not match the deposit.',
      };
    }

    const now = Date.now();
    user.real_balance = Number((Number(user.real_balance || 0) + Number(dep.amount_usd)).toFixed(2));
    dep.status = 'succeeded';
    dep.provider_reference = params.providerReference;
    dep.receipt_number = params.receiptNumber || null;
    dep.confirmed_amount_kes = params.confirmedAmountKes;
    dep.confirmed_at = now;
    dep.updated_at = now;
    dep.failure_reason = null;
    saveDb(db);

    return {
      success: true,
      alreadyCredited: false,
      realBalance: Number(user.real_balance),
    };
  },
};

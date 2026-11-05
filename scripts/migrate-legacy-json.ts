import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

type LegacyUser = {
  id: string; email: string; phone: string; passwordHash: string; salt: string;
  role?: string; createdAt: number; emailVerified?: boolean; phoneVerified?: boolean;
  emailVerificationCode?: string; emailVerificationExpires?: number;
  phoneVerificationCode?: string; phoneVerificationExpires?: number;
  resetPasswordToken?: string; resetPasswordExpires?: number;
  demoBalance?: number; realBalance?: number; fullName?: string; country?: string;
  theme?: string; soundEnabled?: boolean;
};
type LegacyDeposit = {
  id: string; userId: string; merchantReference: string; amountKes: number;
  amountSubunits?: number; amountUsd: number; currency?: string; sessionId?: string;
  checkoutUrl?: string; providerReference?: string; receiptNumber?: string;
  status?: string; failureReason?: string; confirmedAmountKes?: number;
  createdAt: number; updatedAt?: number; confirmedAt?: number;
};
type LegacyDatabase = {
  users?: LegacyUser[];
  sessions?: Array<{ token: string; userId: string; createdAt: number; expiresAt: number }>;
  trades?: Array<Record<string, unknown> & { id?: string; userId?: string; recordedAt?: number }>;
  deposits?: LegacyDeposit[];
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function main() {
  const source = path.resolve(process.cwd(), 'data/db.json');
  if (!fs.existsSync(source)) throw new Error('Legacy data/db.json was not found.');
  const legacy = JSON.parse(fs.readFileSync(source, 'utf8')) as LegacyDatabase;
  const users = legacy.users ?? [];
  const trades = legacy.trades ?? [];
  const deposits = legacy.deposits ?? [];

  if (!Array.isArray(users) || !Array.isArray(trades) || !Array.isArray(deposits)) {
    throw new Error('Legacy database has an invalid structure.');
  }
  if (users.some((u) => !u.id || !u.email || !u.phone || !u.passwordHash || !u.salt)) {
    throw new Error('A legacy user is missing a required account field; no migration was attempted.');
  }
  const userIds = new Set(users.map((u) => u.id));
  if (deposits.some((d) => !userIds.has(d.userId))) {
    throw new Error('A legacy deposit references a user that is not in the legacy user list.');
  }
  if (trades.some((t) => t.userId && !userIds.has(String(t.userId)))) {
    throw new Error('A legacy trade references a user that is not in the legacy user list.');
  }

  const supabase = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SECRET_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  const userRows = users.map((u) => ({
    id: u.id,
    email: u.email.toLowerCase(),
    phone: u.phone,
    password_hash: u.passwordHash,
    salt: u.salt,
    role: u.role === 'admin' ? 'admin' : 'user',
    created_at: Number(u.createdAt) || Date.now(),
    email_verified: Boolean(u.emailVerified),
    phone_verified: Boolean(u.phoneVerified),
    email_verification_code: u.emailVerificationCode ?? null,
    email_verification_expires: u.emailVerificationExpires ?? null,
    phone_verification_code: u.phoneVerificationCode ?? null,
    phone_verification_expires: u.phoneVerificationExpires ?? null,
    reset_password_token: null,
    reset_password_expires: null,
    demo_balance: Number(u.demoBalance ?? 10000),
    real_balance: Number(u.realBalance ?? 0),
    full_name: u.fullName ?? null,
    country: u.country ?? null,
    theme: u.theme ?? null,
    sound_enabled: u.soundEnabled ?? null,
  }));

  if (userRows.length) {
    const { error } = await supabase.from('users').upsert(userRows, { onConflict: 'id' });
    if (error) throw new Error(`User migration failed: ${error.message}`);
  }

  const tradeRows = trades.map((trade, index) => ({
    id: String(trade.id ?? `legacy_trade_${index}`),
    user_id: String(trade.userId),
    trade_data: trade,
    recorded_at: Number(trade.recordedAt ?? trade.createdAt) || Date.now(),
  }));
  if (tradeRows.length) {
    const { error } = await supabase.from('trades').upsert(tradeRows, { onConflict: 'id' });
    if (error) throw new Error(`Trade migration failed: ${error.message}`);
  }

  const depositRows = deposits.map((d) => ({
    id: d.id,
    user_id: d.userId,
    merchant_reference: d.merchantReference,
    amount_kes: Number(d.amountKes),
    amount_subunits: Number(d.amountSubunits ?? Math.round(Number(d.amountKes) * 100)),
    amount_usd: Number(d.amountUsd),
    currency: d.currency ?? 'KES',
    session_id: d.sessionId ?? null,
    checkout_url: d.checkoutUrl ?? null,
    provider_reference: d.providerReference ?? null,
    receipt_number: d.receiptNumber ?? null,
    status: d.status ?? 'pending',
    failure_reason: d.failureReason ?? null,
    confirmed_amount_kes: d.confirmedAmountKes ?? null,
    created_at: Number(d.createdAt) || Date.now(),
    updated_at: Number(d.updatedAt ?? d.createdAt) || Date.now(),
    confirmed_at: d.confirmedAt ?? null,
  }));
  if (depositRows.length) {
    const { error } = await supabase.from('deposits').upsert(depositRows, { onConflict: 'id' });
    if (error) throw new Error(`Deposit migration failed: ${error.message}`);
  }

  // Old bearer tokens were committed to a public repository. Do not migrate any
  // legacy sessions; invalidate every existing Supabase session as well.
  const { error: sessionError } = await supabase
    .from('sessions')
    .delete()
    .not('token', 'is', null);
  if (sessionError) throw new Error(`Session invalidation failed: ${sessionError.message}`);

  console.log('Legacy data migration completed.');
  console.log(`Preserved users: ${userRows.length}`);
  console.log(`Preserved trades: ${tradeRows.length}`);
  console.log(`Preserved deposits: ${depositRows.length}`);
  console.log('Legacy sessions: intentionally invalidated; users must sign in again.');
  console.log('Password hashes were preserved for account continuity. Require users to change passwords because the old database was publicly exposed.');
}

main().catch((error) => {
  console.error('Legacy migration failed:', error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
});

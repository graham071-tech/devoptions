/**
 * One-time migration of the legacy data/db.json into Supabase.
 *
 * Run from the repository root:
 *   npx tsx scripts/migrate-legacy-data.ts
 *
 * Required server-only environment variables:
 *   SUPABASE_URL
 *   SUPABASE_SECRET_KEY
 *
 * This script is idempotent: users, trades and deposits are upserted.
 * Legacy sessions and password-reset/verification tokens are intentionally
 * not migrated. Existing password hashes and salts are retained so accounts
 * keep their current passwords.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

type LegacyUser = {
  id: string;
  email: string;
  phone: string;
  passwordHash: string;
  salt: string;
  role?: string;
  createdAt: number;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  demoBalance?: number;
  realBalance?: number;
  fullName?: string;
  country?: string;
  theme?: string;
  soundEnabled?: boolean;
};

type LegacyDeposit = {
  id: string;
  userId: string;
  merchantReference: string;
  amountKes: number;
  amountSubunits: number;
  amountUsd: number;
  currency?: string;
  sessionId?: string;
  checkoutUrl?: string;
  providerReference?: string;
  receiptNumber?: string;
  status: string;
  failureReason?: string;
  confirmedAmountKes?: number;
  createdAt: number;
  updatedAt: number;
  confirmedAt?: number;
};

async function main() {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY. Use server-side secrets only.');
  }

  let legacyText: string;
  const legacyPath = path.resolve(process.cwd(), 'data/db.json');
  if (fs.existsSync(legacyPath)) {
    legacyText = fs.readFileSync(legacyPath, 'utf8');
  } else {
    // Recover the original committed file from the base branch's Git history.
    try {
      legacyText = execFileSync('git', ['show', 'origin/main:data/db.json'], { encoding: 'utf8' });
    } catch {
      legacyText = execFileSync('git', ['show', 'main:data/db.json'], { encoding: 'utf8' });
    }
  }

  const legacy = JSON.parse(legacyText) as {
    users?: LegacyUser[];
    trades?: Record<string, any>[];
    deposits?: LegacyDeposit[];
  };

  const users = legacy.users || [];
  const trades = legacy.trades || [];
  const deposits = legacy.deposits || [];

  if (!users.length && !trades.length && !deposits.length) {
    throw new Error('The legacy database is empty; refusing to run an empty migration.');
  }

  const supabase = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  // Keep password hashes/salts so users retain their passwords. Never copy
  // old sessions, OTPs, password-reset tokens or their expiry timestamps.
  const userRows = users.map((u) => ({
    id: u.id,
    email: u.email.trim().toLowerCase(),
    phone: u.phone,
    password_hash: u.passwordHash,
    salt: u.salt,
    role: u.role === 'admin' ? 'admin' : 'user',
    created_at: Number(u.createdAt) || Date.now(),
    email_verified: Boolean(u.emailVerified),
    phone_verified: Boolean(u.phoneVerified),
    demo_balance: Number(u.demoBalance ?? 10000),
    real_balance: Number(u.realBalance ?? 0),
    full_name: u.fullName || null,
    country: u.country || 'International',
    theme: u.theme || null,
    sound_enabled: u.soundEnabled ?? null,
    email_verification_code: null,
    email_verification_expires: null,
    phone_verification_code: null,
    phone_verification_expires: null,
    reset_password_token: null,
    reset_password_expires: null,
  }));

  if (userRows.length) {
    const { error } = await supabase.from('users').upsert(userRows, { onConflict: 'id' });
    if (error) throw new Error('Users migration failed: ' + error.message);
  }

  // Keep all historical trade/ledger records, if any.
  for (const t of trades) {
    if (!t?.id || !t?.userId) continue;
    const { error } = await supabase.from('trades').upsert({
      id: String(t.id),
      user_id: String(t.userId),
      trade_data: t,
      recorded_at: Number(t.recordedAt ?? t.createdAt) || Date.now(),
    }, { onConflict: 'id' });
    if (error) throw new Error('Trade migration failed for ' + String(t.id) + ': ' + error.message);
  }

  // Preserve pending and completed Paynecta deposits exactly as recorded.
  const depositRows = deposits.map((d) => ({
    id: d.id,
    user_id: d.userId,
    merchant_reference: d.merchantReference,
    amount_kes: Number(d.amountKes),
    amount_subunits: Number(d.amountSubunits),
    amount_usd: Number(d.amountUsd),
    currency: d.currency || 'KES',
    session_id: d.sessionId || null,
    checkout_url: d.checkoutUrl || null,
    provider_reference: d.providerReference || null,
    receipt_number: d.receiptNumber || null,
    status: d.status,
    failure_reason: d.failureReason || null,
    confirmed_amount_kes: d.confirmedAmountKes ?? null,
    created_at: Number(d.createdAt) || Date.now(),
    updated_at: Number(d.updatedAt) || Date.now(),
    confirmed_at: d.confirmedAt ?? null,
  }));

  if (depositRows.length) {
    const { error } = await supabase.from('deposits').upsert(depositRows, { onConflict: 'id' });
    if (error) throw new Error('Deposits migration failed: ' + error.message);
  }

  console.log('Legacy data migration completed.');
  console.log('Users migrated: ' + userRows.length);
  console.log('Trades migrated: ' + trades.length);
  console.log('Deposits migrated: ' + depositRows.length);
  console.log('Legacy sessions deliberately not migrated: ' + (legacy as any).sessions?.length || 0);
}

main().catch((error) => {
  console.error('Legacy data migration failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

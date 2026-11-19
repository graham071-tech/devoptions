import crypto from 'crypto';
import dotenv from 'dotenv';
import { getSupabaseClient, shouldUseLocalFallback } from '../src/services/supabaseService';
import { localFallbackStore, SEEDED_ADMINS } from '../server/localFallbackStore';

dotenv.config();

async function run() {
  const emailArg = process.env.ADMIN_EMAIL || 'francisgraham071@gmail.com';
  const targetEmail = emailArg.trim().toLowerCase();
  const rawPassword = process.env.ADMIN_RESET_PASSWORD;

  let salt: string;
  let passwordHash: string;

  if (rawPassword) {
    salt = crypto.randomBytes(16).toString('hex');
    passwordHash = crypto.scryptSync(rawPassword, salt, 64).toString('hex');
  } else {
    const configured = SEEDED_ADMINS.find((adm) => adm.email.toLowerCase() === targetEmail);
    if (!configured) {
      throw new Error(
        `No pre-hashed credentials found for ${targetEmail}. Provide ADMIN_RESET_PASSWORD in the environment.`
      );
    }
    salt = configured.salt;
    passwordHash = configured.password_hash;
  }

  const now = Date.now();
  const useLocal = await shouldUseLocalFallback();

  if (!useLocal) {
    const supabase = getSupabaseClient();
    const { data: existing, error: lookupError } = await supabase
      .from('users')
      .select('id,email,role,demo_balance,real_balance')
      .ilike('email', targetEmail.replace(/[\\%_]/g, '\\$&'))
      .maybeSingle();

    if (lookupError) throw lookupError;
    if (!existing) {
      throw new Error(`Administrator account ${targetEmail} not found in Supabase public.users.`);
    }

    const { error: updateError } = await supabase
      .from('users')
      .update({
        salt,
        password_hash: passwordHash,
        reset_password_token: null,
        reset_password_expires: null,
      })
      .eq('id', existing.id);

    if (updateError) throw updateError;
    await supabase.from('sessions').delete().eq('user_id', existing.id);
    console.log(
      `[Admin Password Reset] Updated Supabase user ${existing.email} (id=${existing.id}) and cleared prior sessions.`
    );
  } else {
    const localUser = localFallbackStore.findUserByEmail(targetEmail);
    if (!localUser) {
      throw new Error(`Administrator account ${targetEmail} not found in local store.`);
    }
    localFallbackStore.updateUser(localUser.id, {
      salt,
      password_hash: passwordHash,
      reset_password_token: null,
      reset_password_expires: null,
      token_valid_after: now,
    });
    localFallbackStore.deleteSessionsByUser(localUser.id);
    console.log(
      `[Admin Password Reset] Updated persistent local store user ${localUser.email} (id=${localUser.id}).`
    );
  }
}

run().catch((err) => {
  console.error('[Admin Password Reset Error]:', err instanceof Error ? err.message : err);
  process.exit(1);
});

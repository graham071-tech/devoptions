import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseClient: SupabaseClient | null = null;
let supabaseStatusCache: { reachable: boolean; checkedAt: number } | null = null;
const REACHABILITY_CACHE_MS = 30_000;

export function getSupabaseClient(): SupabaseClient {
  if (supabaseClient) {
    return supabaseClient;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error(
      'Supabase configuration is missing. Check SUPABASE_URL and SUPABASE_SECRET_KEY.'
    );
  }

  supabaseClient = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  return supabaseClient;
}

export function isSupabaseTransportError(err: any): boolean {
  if (!err) return false;
  const parts = [
    err.message,
    err.details,
    err.hint,
    err.code,
    err.cause?.message,
    err.cause?.code,
    String(err),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return (
    parts.includes('supabase configuration is missing') ||
    parts.includes('fetch failed') ||
    parts.includes('enotfound') ||
    parts.includes('econnrefused') ||
    parts.includes('eai_again') ||
    parts.includes('etimedout') ||
    parts.includes('econnreset') ||
    parts.includes('network') ||
    parts.includes('abort')
  );
}

export function markSupabaseUnreachable(): void {
  supabaseStatusCache = { reachable: false, checkedAt: Date.now() };
}

export async function shouldUseLocalFallback(): Promise<boolean> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    return true;
  }

  const now = Date.now();
  if (supabaseStatusCache && now - supabaseStatusCache.checkedAt < REACHABILITY_CACHE_MS) {
    return !supabaseStatusCache.reachable;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      const res = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/`, {
        method: 'HEAD',
        headers: {
          apikey: supabaseSecretKey,
          Authorization: `Bearer ${supabaseSecretKey}`,
        },
        signal: controller.signal,
      });
      // Any HTTP response (even 401/404) confirms network + DNS reachability
      const reachable = res.status > 0;
      supabaseStatusCache = { reachable, checkedAt: now };
      return !reachable;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    if (isSupabaseTransportError(err)) {
      console.warn(
        '[Supabase Reachability] Supabase host unreachable; using local persistent store fallback.'
      );
      supabaseStatusCache = { reachable: false, checkedAt: now };
      return true;
    }
    supabaseStatusCache = { reachable: false, checkedAt: now };
    return true;
  }
}

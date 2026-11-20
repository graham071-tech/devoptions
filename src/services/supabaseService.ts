import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseClient: SupabaseClient | null = null;
let supabaseClientSignature = '';
let supabaseStatusCache: { reachable: boolean; checkedAt: number; detail?: string } | null = null;
const REACHABLE_CACHE_MS = 30_000;
const UNREACHABLE_CACHE_MS = 5_000;

export function getSupabaseConfig(): {
  url: string | null;
  secretKey: string | null;
  keyFormat: 'jwt' | 'opaque' | 'missing';
} {
  const url = (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ''
  ).trim() || null;

  const secretKey = (
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ''
  ).trim() || null;

  const keyFormat: 'jwt' | 'opaque' | 'missing' = !secretKey
    ? 'missing'
    : isJwtKey(secretKey)
    ? 'jwt'
    : 'opaque';

  return { url, secretKey, keyFormat };
}

export function isJwtKey(key: string): boolean {
  const trimmed = key.trim();
  return trimmed.startsWith('eyJ') && trimmed.split('.').length === 3;
}

export function isProductionServerless(): boolean {
  return Boolean(process.env.VERCEL);
}

export function getSupabaseClient(): SupabaseClient {
  const { url: supabaseUrl, secretKey: supabaseSecretKey } = getSupabaseConfig();

  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error(
      'Supabase configuration is missing. Check SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY).'
    );
  }

  const signature = `${supabaseUrl}::${supabaseSecretKey.slice(0, 12)}::${supabaseSecretKey.length}`;
  if (supabaseClient && supabaseClientSignature === signature) {
    return supabaseClient;
  }

  // Opaque Supabase secret keys (`sb_secret_*`) are not JWTs.
  // `@supabase/supabase-js` copies the API key into `Authorization: Bearer <key>`,
  // which causes PostgREST to reject opaque secret keys as invalid JWTs.
  // Strip that copied Authorization header when the key is opaque while keeping `apikey`.
  const opaqueKey = !isJwtKey(supabaseSecretKey);
  const customFetch: typeof fetch = async (input, init) => {
    if (!opaqueKey) {
      return fetch(input, init);
    }
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    const auth = headers.get('authorization');
    if (auth && auth.trim() === `Bearer ${supabaseSecretKey}`) {
      headers.delete('authorization');
    }
    return fetch(input, {
      ...init,
      headers,
    });
  };

  supabaseClient = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: customFetch,
    },
  });
  supabaseClientSignature = signature;

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

export function markSupabaseUnreachable(detail?: string): void {
  supabaseStatusCache = { reachable: false, checkedAt: Date.now(), detail };
}

export function resetSupabaseStatusCache(): void {
  supabaseClient = null;
  supabaseClientSignature = '';
  supabaseStatusCache = null;
}

export async function checkSupabaseConnectivity(): Promise<{
  configured: boolean;
  reachable: boolean;
  keyFormat: 'jwt' | 'opaque' | 'missing';
  detail?: string;
}> {
  const { url: supabaseUrl, secretKey: supabaseSecretKey, keyFormat } = getSupabaseConfig();

  if (!supabaseUrl || !supabaseSecretKey) {
    return {
      configured: false,
      reachable: false,
      keyFormat,
      detail: 'Missing SUPABASE_URL or SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY.',
    };
  }

  const now = Date.now();
  if (supabaseStatusCache) {
    const ttl = supabaseStatusCache.reachable ? REACHABLE_CACHE_MS : UNREACHABLE_CACHE_MS;
    if (now - supabaseStatusCache.checkedAt < ttl) {
      return {
        configured: true,
        reachable: supabaseStatusCache.reachable,
        keyFormat,
        detail: supabaseStatusCache.detail,
      };
    }
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const headers: Record<string, string> = {
        apikey: supabaseSecretKey,
      };
      if (isJwtKey(supabaseSecretKey)) {
        headers.Authorization = `Bearer ${supabaseSecretKey}`;
      }
      const res = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/`, {
        method: 'GET',
        headers: {
          ...headers,
          Accept: 'application/openapi+json',
        },
        signal: controller.signal,
      });

      if (res.status === 401 || res.status === 403) {
        const detail = `Supabase rejected API credentials (HTTP ${res.status}). Verify SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY.`;
        console.error('[Supabase Connectivity]', detail);
        supabaseStatusCache = { reachable: false, checkedAt: now, detail };
        return { configured: true, reachable: false, keyFormat, detail };
      }

      const reachable = res.status > 0 && res.status < 500;
      const detail = reachable ? undefined : `Supabase gateway returned HTTP ${res.status}.`;
      supabaseStatusCache = { reachable, checkedAt: now, detail };
      return { configured: true, reachable, keyFormat, detail };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Supabase host unreachable';
    if (isSupabaseTransportError(err)) {
      console.warn('[Supabase Reachability] Supabase host unreachable:', detail);
    }
    supabaseStatusCache = { reachable: false, checkedAt: now, detail };
    return { configured: true, reachable: false, keyFormat, detail };
  }
}

export async function shouldUseLocalFallback(): Promise<boolean> {
  const status = await checkSupabaseConnectivity();
  if (!status.configured) {
    return true;
  }
  return !status.reachable;
}

// Frontend authentication client communicating with /api/auth/* backend

export interface AuthUser {
  id: string;
  email: string;
  phone: string;
  role?: 'admin' | 'user';
  emailVerified: boolean;
  phoneVerified: boolean;
  demoBalance: number;
  realBalance: number;
  fullName: string;
  country: string;
  createdAt: number;
  devNotice?: {
    emailOtp?: string;
    phoneOtp?: string;
    info?: string;
  };
}

export interface AdminMetrics {
  totalUsers: number;
  verifiedUsers: number;
  activeSessions: number;
  totalTrades: number;
  totalVolume: number;
  netProfitLoss: number;
  adminsCount: number;
}

export interface AdminOverviewResponse {
  metrics: AdminMetrics;
  defaultAccounts: Array<{
    email: string;
    role: string;
    description: string;
  }>;
}

export interface AdminUserRecord {
  id: string;
  email: string;
  phone: string;
  role: 'admin' | 'user';
  emailVerified: boolean;
  phoneVerified: boolean;
  demoBalance: number;
  realBalance: number;
  fullName: string;
  country: string;
  createdAt: number;
}

export interface RegisterPayload {
  email: string;
  phone: string;
  password: string;
  confirmPassword?: string;
  fullName?: string;
  name?: string;
}

export interface LoginPayload {
  identifier: string; // email or phone
  password: string;
}

export function normalizeUser(raw: any): AuthUser {
  if (!raw) return raw;
  const demoBalance = Number(
    raw.demoBalance ?? raw.balances?.demo ?? (typeof raw.balances === 'object' ? raw.balances?.demo : undefined) ?? 10000
  );
  const realBalance = Number(
    raw.realBalance ?? raw.balances?.real ?? (typeof raw.balances === 'object' ? raw.balances?.real : undefined) ?? 0
  );
  return {
    id: raw.id || '',
    email: raw.email || '',
    phone: raw.phone || '',
    role: raw.role === 'admin' ? 'admin' : (raw.role || 'user'),
    emailVerified: Boolean(raw.emailVerified ?? raw.email_verified),
    phoneVerified: Boolean(raw.phoneVerified ?? raw.phone_verified),
    demoBalance: isNaN(demoBalance) ? 10000 : demoBalance,
    realBalance: isNaN(realBalance) ? 0 : realBalance,
    fullName: raw.fullName || raw.full_name || raw.name || '',
    country: raw.country || 'International',
    createdAt: Number(raw.createdAt || raw.created_at || raw.memberSince || Date.now()),
    devNotice: raw.devNotice,
  };
}

export interface AdminRiskState {
  userId: string;
  enabled: boolean;
  consecutiveLosses: number;
  maxConsecutiveLosses: number;
  totalLosses: number;
  maxTotalLosses: number;
  configuredMaxLoss: number;
  sessionNetPnl: number;
  cumulativeLoss: number;
  activeOpenStake: number;
  remainingLossAllowance: number;
  halted: boolean;
  haltReason: string | null;
  haltCode: 'MAX_CONSECUTIVE_LOSSES' | 'MAX_TOTAL_LOSSES' | 'MAX_LOSS_REACHED' | null;
  activeMode: 'demo' | 'real';
  botRunning: boolean;
  periodStartedAt: number;
  periodResetCount: number;
  updatedAt: number;
}

const TOKEN_KEY = 'devoptions_auth_token';
const USER_KEY = 'devoptions_auth_user';
const EXPIRES_AT_KEY = 'devoptions_auth_expires_at';
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_THRESHOLD_MS = 3.5 * 24 * 60 * 60 * 1000;
const MAX_TIMEOUT_MS = 2_000_000_000;
const MAX_AUTH_LOGS = 100;

export type AuthLogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface AuthStateLogEntry {
  id: number;
  timestamp: number;
  isoTime: string;
  event: string;
  level: AuthLogLevel;
  authState: 'authenticated' | 'unauthenticated';
  userId: string | null;
  email: string | null;
  reason?: string;
  details?: Record<string, any>;
}

function getStorageArea(kind: 'local' | 'session'): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function safeStorageGet(key: string): string | null {
  const local = getStorageArea('local');
  const session = getStorageArea('session');
  let localValue: string | null = null;
  if (local) {
    try {
      localValue = local.getItem(key);
    } catch {
      localValue = null;
    }
  }
  if (localValue !== null) {
    if (session) {
      try {
        if (session.getItem(key) !== localValue) {
          session.setItem(key, localValue);
        }
      } catch {
        // Ignore write restriction
      }
    }
    return localValue;
  }

  if (session) {
    try {
      const sessionValue = session.getItem(key);
      if (sessionValue !== null) {
        // Heal localStorage from sessionStorage backup if localStorage was cleared externally
        if (local) {
          try {
            local.setItem(key, sessionValue);
          } catch {
            // Ignore write restriction
          }
        }
        return sessionValue;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function safeStorageSet(key: string, value: string): void {
  const local = getStorageArea('local');
  const session = getStorageArea('session');
  if (local) {
    try {
      local.setItem(key, value);
    } catch {
      // Ignore storage quota/privacy errors; sessionStorage/in-memory remain active
    }
  }
  if (session) {
    try {
      session.setItem(key, value);
    } catch {
      // Ignore storage quota/privacy errors
    }
  }
}

function safeStorageRemove(key: string): void {
  const local = getStorageArea('local');
  const session = getStorageArea('session');
  if (local) {
    try {
      local.removeItem(key);
    } catch {
      // Ignore
    }
  }
  if (session) {
    try {
      session.removeItem(key);
    } catch {
      // Ignore
    }
  }
}

function maskToken(token: string | null | undefined): string {
  if (!token) return 'none';
  if (token.length <= 12) return `${token.slice(0, 3)}*** (len=${token.length})`;
  return `${token.slice(0, 8)}...${token.slice(-4)} (len=${token.length})`;
}

function decodeBase64Url(input: string): string | null {
  try {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const padLength = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + '='.repeat(padLength);
    if (typeof atob === 'function') {
      return atob(padded);
    }
    return null;
  } catch {
    return null;
  }
}

function decodeSignedTokenExpiry(token: string | null): number | null {
  if (!token || !token.startsWith('v1.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  const jsonStr = decodeBase64Url(parts[1]);
  if (!jsonStr) return null;
  try {
    const parsed = JSON.parse(jsonStr);
    return typeof parsed?.exp === 'number' && Number.isFinite(parsed.exp) ? parsed.exp : null;
  } catch {
    return null;
  }
}

function haveAuthUserFieldsChanged(a: AuthUser | null, b: AuthUser | null): boolean {
  if (a === b) return false;
  if (!a || !b) return true;
  return (
    a.id !== b.id ||
    a.email !== b.email ||
    a.phone !== b.phone ||
    a.role !== b.role ||
    a.emailVerified !== b.emailVerified ||
    a.phoneVerified !== b.phoneVerified ||
    a.demoBalance !== b.demoBalance ||
    a.realBalance !== b.realBalance ||
    a.fullName !== b.fullName ||
    a.country !== b.country
  );
}

export class AuthClient {
  private token: string | null = null;
  private currentUser: AuthUser | null = null;
  private expiresAt: number | null = null;
  private listeners: ((user: AuthUser | null) => void)[] = [];
  private lastRiskState: AdminRiskState | null = null;
  private riskListeners: Set<(state: AdminRiskState | null) => void> = new Set();
  private authLogs: AuthStateLogEntry[] = [];
  private logListeners: Set<(entry: AuthStateLogEntry) => void> = new Set();
  private nextLogId = 1;
  private lastLoggedStateSignature = 'unauthenticated:none';
  private refreshInFlight: Promise<AuthUser | null> | null = null;
  private fetchMeInFlight: Promise<AuthUser | null> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.token = safeStorageGet(TOKEN_KEY);
    const cachedUser = safeStorageGet(USER_KEY);
    if (cachedUser) {
      try {
        this.currentUser = normalizeUser(JSON.parse(cachedUser));
      } catch {
        this.currentUser = null;
        safeStorageRemove(USER_KEY);
        this.recordLog('warn', 'CORRUPTED_USER_CACHE', 'Invalid cached user JSON cleared');
      }
    }
    this.expiresAt = this.resolveStoredExpiry(this.token);

    if (this.token && this.currentUser) {
      this.recordLog('info', 'INIT_RESTORED', 'Restored persisted session from storage', {
        token: maskToken(this.token),
        expiresAt: this.expiresAt,
      });
      this.emitStateTransitionIfChanged('init_restore');
      this.scheduleTokenRefresh();
    } else {
      this.recordLog('debug', 'INIT_EMPTY', 'No persisted session found on startup');
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('storage', this.handleCrossTabStorageEvent);
    }
  }

  private resolveStoredExpiry(token: string | null): number | null {
    const decodedExp = decodeSignedTokenExpiry(token);
    if (decodedExp) {
      safeStorageSet(EXPIRES_AT_KEY, String(decodedExp));
      return decodedExp;
    }
    const rawStored = safeStorageGet(EXPIRES_AT_KEY);
    if (rawStored) {
      const parsed = Number(rawStored);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return token ? Date.now() + DEFAULT_SESSION_TTL_MS : null;
  }

  private handleCrossTabStorageEvent = (event: StorageEvent) => {
    const local = getStorageArea('local');
    if (event.storageArea && local && event.storageArea !== local) {
      return;
    }
    if (
      event.key !== null &&
      event.key !== TOKEN_KEY &&
      event.key !== USER_KEY &&
      event.key !== EXPIRES_AT_KEY
    ) {
      return;
    }

    // Read directly from localStorage for cross-tab events so an explicit sign-out
    // in another tab is propagated rather than overwritten by this tab's sessionStorage.
    let nextToken: string | null = null;
    let rawUser: string | null = null;
    let rawExpires: string | null = null;
    if (local) {
      try {
        nextToken = local.getItem(TOKEN_KEY);
        rawUser = local.getItem(USER_KEY);
        rawExpires = local.getItem(EXPIRES_AT_KEY);
      } catch {
        return;
      }
    }

    const session = getStorageArea('session');
    if (!nextToken) {
      if (session) {
        try {
          session.removeItem(TOKEN_KEY);
          session.removeItem(USER_KEY);
          session.removeItem(EXPIRES_AT_KEY);
        } catch {
          // Ignore
        }
      }
      if (this.token || this.currentUser) {
        this.recordLog('info', 'STORAGE_SYNC', 'Cross-tab sign-out detected', {
          key: event.key ?? 'all',
        });
        this.clearSession('storage_sync');
      }
      return;
    }

    if (session) {
      try {
        session.setItem(TOKEN_KEY, nextToken);
        if (rawUser !== null) session.setItem(USER_KEY, rawUser);
        if (rawExpires !== null) session.setItem(EXPIRES_AT_KEY, rawExpires);
      } catch {
        // Ignore
      }
    }

    let nextUser: AuthUser | null = null;
    if (rawUser) {
      try {
        nextUser = normalizeUser(JSON.parse(rawUser));
      } catch {
        nextUser = null;
      }
    }
    const nextExpiresAt = this.resolveStoredExpiry(nextToken);

    const tokenChanged = nextToken !== this.token;
    const userChanged = haveAuthUserFieldsChanged(this.currentUser, nextUser);
    if (!tokenChanged && !userChanged) return;

    this.token = nextToken;
    this.currentUser = nextUser;
    this.expiresAt = nextExpiresAt;

    this.recordLog('info', 'STORAGE_SYNC', 'Synchronized auth state from cross-tab storage event', {
      key: event.key ?? 'all',
      token: maskToken(nextToken),
      hasUser: Boolean(nextUser),
    });

    if (this.token && this.currentUser) {
      this.scheduleTokenRefresh();
    } else {
      this.clearRefreshTimer();
      this.setRiskState(null);
    }

    this.emitStateTransitionIfChanged('storage_sync');
    if (userChanged) {
      this.notify();
    }
  };

  private recordLog(
    level: AuthLogLevel,
    event: string,
    reason?: string,
    details?: Record<string, any>
  ) {
    const now = Date.now();
    const entry: AuthStateLogEntry = {
      id: this.nextLogId++,
      timestamp: now,
      isoTime: new Date(now).toISOString(),
      event,
      level,
      authState: this.isAuthenticated() ? 'authenticated' : 'unauthenticated',
      userId: this.currentUser?.id || null,
      email: this.currentUser?.email || null,
      ...(reason ? { reason } : {}),
      ...(details ? { details } : {}),
    };

    this.authLogs.push(entry);
    if (this.authLogs.length > MAX_AUTH_LOGS) {
      this.authLogs.shift();
    }

    const consolePayload = {
      authState: entry.authState,
      userId: entry.userId,
      email: entry.email,
      ...(reason ? { reason } : {}),
      ...(details || {}),
    };
    const prefix = `[AuthClient] ${event}`;
    if (level === 'error') {
      console.error(prefix, consolePayload);
    } else if (level === 'warn') {
      console.warn(prefix, consolePayload);
    } else if (level === 'debug') {
      console.debug(prefix, consolePayload);
    } else {
      console.info(prefix, consolePayload);
    }

    this.logListeners.forEach((cb) => {
      try {
        cb(entry);
      } catch {
        // Ignore listener errors
      }
    });
  }

  private emitStateTransitionIfChanged(trigger: string) {
    const nextSignature = this.isAuthenticated()
      ? `authenticated:${this.currentUser?.id || 'unknown'}:${this.currentUser?.role || 'user'}`
      : 'unauthenticated:none';
    if (nextSignature === this.lastLoggedStateSignature) return;
    const previous = this.lastLoggedStateSignature;
    this.lastLoggedStateSignature = nextSignature;
    this.recordLog('info', 'AUTH_STATE_CHANGED', trigger, {
      from: previous,
      to: nextSignature,
      subscribers: this.listeners.length,
    });
  }

  public getAuthLogs(): AuthStateLogEntry[] {
    return [...this.authLogs];
  }

  public clearAuthLogs(): void {
    this.authLogs = [];
  }

  public subscribeLogs(cb: (entry: AuthStateLogEntry) => void): () => void {
    this.logListeners.add(cb);
    return () => {
      this.logListeners.delete(cb);
    };
  }

  public getSessionExpiresAt(): number | null {
    return this.expiresAt;
  }

  public getToken(): string | null {
    if (!this.token) {
      this.token = safeStorageGet(TOKEN_KEY);
      if (this.token && !this.expiresAt) {
        this.expiresAt = this.resolveStoredExpiry(this.token);
      }
    }
    return this.token;
  }

  public getAuthHeaders(extra?: Record<string, string>): HeadersInit {
    const token = this.getToken();
    return {
      ...(token ? {
        Authorization: `Bearer ${token}`,
        'x-auth-token': token,
      } : {}),
      ...extra,
    };
  }

  public getCurrentUser(): AuthUser | null {
    if (!this.currentUser) {
      const cached = safeStorageGet(USER_KEY);
      if (cached) {
        try {
          this.currentUser = normalizeUser(JSON.parse(cached));
        } catch {
          this.currentUser = null;
        }
      }
    }
    return this.currentUser;
  }

  public isAuthenticated(): boolean {
    return !!(this.getToken() || this.currentUser) && !!this.getCurrentUser();
  }

  public subscribe(cb: (user: AuthUser | null) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  public getLastRiskState(): AdminRiskState | null {
    return this.lastRiskState;
  }

  public subscribeRiskState(cb: (state: AdminRiskState | null) => void): () => void {
    this.riskListeners.add(cb);
    cb(this.lastRiskState);
    return () => {
      this.riskListeners.delete(cb);
    };
  }

  private setRiskState(next: AdminRiskState | null) {
    this.lastRiskState = next;
    this.riskListeners.forEach((cb) => cb(next));
  }

  private async readResponse(res: Response): Promise<any> {
    const contentType = res.headers.get('content-type') || '';
    const body = await res.text();

    if (contentType.includes('application/json')) {
      try {
        return body ? JSON.parse(body) : {};
      } catch {
        throw new Error(`Server returned invalid JSON (HTTP ${res.status}). Please try again.`);
      }
    }

    // Vercel and proxy errors are often HTML. Avoid exposing a raw JSON parse error.
    const plainMessage = body
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220);

    const detail = plainMessage || `Unexpected response type: ${contentType || 'unknown'}`;
    throw new Error(`API request failed (HTTP ${res.status}). ${detail}`);
  }

  private clearRefreshTimer() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private scheduleTokenRefresh() {
    this.clearRefreshTimer();
    const token = this.getToken();
    if (!token || !this.expiresAt) return;

    const now = Date.now();
    const refreshAt = this.expiresAt - REFRESH_THRESHOLD_MS;
    const delayMs = Math.min(MAX_TIMEOUT_MS, Math.max(60_000, refreshAt - now));

    this.recordLog('debug', 'TOKEN_REFRESH_SCHEDULED', 'Armed background token refresh timer', {
      delayMs,
      expiresAt: this.expiresAt,
    });

    this.refreshTimer = setTimeout(() => {
      if (this.getToken()) {
        void this.refreshToken('scheduled_timer');
      }
    }, delayMs);
  }

  private shouldProactivelyRefresh(): boolean {
    const token = this.getToken();
    if (!token || !this.expiresAt) return false;
    return this.expiresAt - Date.now() < REFRESH_THRESHOLD_MS;
  }

  private notify() {
    for (const listener of this.listeners) {
      listener(this.currentUser);
    }
  }

  private setSession(
    token: string,
    user: AuthUser,
    source: 'login' | 'register' | 'token_refresh' | 'fetch_me' = 'login',
    explicitExpiresAt?: number | null
  ) {
    const prevUser = this.currentUser;
    const normUser = normalizeUser(user);
    const resolvedExpiresAt =
      (typeof explicitExpiresAt === 'number' && Number.isFinite(explicitExpiresAt) ? explicitExpiresAt : null) ??
      decodeSignedTokenExpiry(token) ??
      Date.now() + DEFAULT_SESSION_TTL_MS;

    this.token = token;
    this.currentUser = normUser;
    this.expiresAt = resolvedExpiresAt;

    safeStorageSet(TOKEN_KEY, token);
    safeStorageSet(USER_KEY, JSON.stringify(normUser));
    safeStorageSet(EXPIRES_AT_KEY, String(resolvedExpiresAt));

    this.recordLog('info', 'SESSION_SET', `Persisted session (${source})`, {
      source,
      token: maskToken(token),
      expiresAt: resolvedExpiresAt,
    });

    this.scheduleTokenRefresh();
    this.emitStateTransitionIfChanged(source);

    if (haveAuthUserFieldsChanged(prevUser, normUser)) {
      this.notify();
    }
  }

  private updateCachedUser(user: AuthUser, reason: string) {
    const prevUser = this.currentUser;
    const normUser = normalizeUser(user);
    this.currentUser = normUser;
    safeStorageSet(USER_KEY, JSON.stringify(normUser));

    if (haveAuthUserFieldsChanged(prevUser, normUser)) {
      this.recordLog('info', 'SESSION_UPDATED', reason);
      this.emitStateTransitionIfChanged(reason);
      this.notify();
    }
  }

  public clearSession(
    reason:
      | 'explicit_logout'
      | 'unauthorized_401'
      | 'refresh_failed'
      | 'manual_clear'
      | 'storage_sync' = 'manual_clear'
  ) {
    const hadSession = Boolean(this.token || this.currentUser || this.lastRiskState);
    const prevToken = this.token;
    this.clearRefreshTimer();
    this.token = null;
    this.currentUser = null;
    this.expiresAt = null;
    safeStorageRemove(TOKEN_KEY);
    safeStorageRemove(USER_KEY);
    safeStorageRemove(EXPIRES_AT_KEY);
    this.setRiskState(null);

    if (hadSession) {
      this.recordLog('info', 'SESSION_CLEARED', reason, {
        previousToken: maskToken(prevToken),
      });
      this.emitStateTransitionIfChanged(reason);
      this.notify();
    } else {
      this.recordLog('debug', 'SESSION_CLEARED_NOOP', reason);
    }
  }

  public async refreshToken(reason = 'manual'): Promise<AuthUser | null> {
    if (this.refreshInFlight) {
      this.recordLog('debug', 'TOKEN_REFRESH_DEDUPED', reason);
      return this.refreshInFlight;
    }

    const tokenAtStart = this.getToken();
    if (!tokenAtStart && !this.currentUser) {
      this.recordLog('debug', 'TOKEN_REFRESH_SKIPPED', 'No token or user available to refresh', { reason });
      return null;
    }

    this.recordLog('info', 'TOKEN_REFRESH_START', reason, {
      token: maskToken(tokenAtStart),
    });

    const run = (async (): Promise<AuthUser | null> => {
      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: this.getAuthHeaders(),
          credentials: 'include',
        });

        if (this.getToken() !== tokenAtStart) {
          this.recordLog('warn', 'TOKEN_REFRESH_SKIPPED_RACE', 'Auth token changed while refresh was in flight', {
            reason,
          });
          return this.currentUser;
        }

        if (res.status === 401) {
          this.recordLog('warn', 'TOKEN_REFRESH_FAILED', 'Server rejected refresh token with 401', { reason });
          this.clearSession('refresh_failed');
          return null;
        }

        if (!res.ok) {
          this.recordLog('warn', 'TOKEN_REFRESH_TRANSIENT_ERROR', `Preserving session after HTTP ${res.status}`, {
            reason,
            status: res.status,
          });
          return this.currentUser;
        }

        const data = await this.readResponse(res);
        if (this.getToken() !== tokenAtStart) {
          this.recordLog('warn', 'TOKEN_REFRESH_SKIPPED_RACE', 'Auth token changed before refresh payload applied');
          return this.currentUser;
        }

        if (data.token && data.user) {
          const normUser = normalizeUser(data.user);
          this.setSession(data.token, normUser, 'token_refresh', data.expiresAt);
          this.recordLog('info', 'TOKEN_REFRESH_SUCCESS', reason, {
            token: maskToken(data.token),
            expiresAt: data.expiresAt ?? this.expiresAt,
          });
          return normUser;
        }

        return this.currentUser;
      } catch (e: any) {
        this.recordLog('warn', 'TOKEN_REFRESH_TRANSIENT_ERROR', 'Network error during token refresh; session preserved', {
          reason,
          error: e?.message || String(e),
        });
        return this.currentUser;
      } finally {
        this.refreshInFlight = null;
      }
    })();

    this.refreshInFlight = run;
    return run;
  }

  private async authorizedFetch(input: string, init: RequestInit = {}, extraHeaders?: Record<string, string>): Promise<Response> {
    if (this.shouldProactivelyRefresh()) {
      await this.refreshToken('proactive_pre_request');
    }

    const firstRes = await fetch(input, {
      ...init,
      headers: this.getAuthHeaders({
        ...(extraHeaders || {}),
      }),
      credentials: 'include',
    });

    if (firstRes.status === 401 && (this.getToken() || this.currentUser)) {
      this.recordLog('warn', 'UNAUTHORIZED_RETRY_REFRESH', `Received 401 on ${input}; attempting token refresh`);
      const refreshed = await this.refreshToken('unauthorized_retry');
      if (refreshed && this.getToken()) {
        return fetch(input, {
          ...init,
          headers: this.getAuthHeaders({
            ...(extraHeaders || {}),
          }),
          credentials: 'include',
        });
      }
    }

    return firstRes;
  }

  public async fetchMe(retryAttempt = 0): Promise<AuthUser | null> {
    if (retryAttempt === 0 && this.fetchMeInFlight) {
      this.recordLog('debug', 'FETCH_ME_DEDUPED', 'Reusing in-flight fetchMe request');
      return this.fetchMeInFlight;
    }

    const tokenAtStart = this.getToken();
    const hadSessionAtStart = Boolean(tokenAtStart || this.currentUser);
    this.recordLog('debug', 'FETCH_ME_START', 'Validating session with /api/auth/me', {
      attempt: retryAttempt,
      hasToken: Boolean(tokenAtStart),
    });

    const exec = async (attempt: number): Promise<AuthUser | null> => {
      try {
        const res = await fetch('/api/auth/me', {
          method: 'GET',
          headers: this.getAuthHeaders(),
          credentials: 'include',
        });

        // Avoid clobbering a newer login/register/logout that occurred while fetchMe was in flight
        if (this.getToken() !== tokenAtStart) {
          this.recordLog('warn', 'FETCH_ME_SKIPPED_RACE', 'Token changed while /api/auth/me was in flight');
          return this.currentUser;
        }

        if (res.status === 401) {
          if (hadSessionAtStart) {
            this.recordLog('warn', 'FETCH_ME_UNAUTHORIZED', 'Stored session rejected by server with 401');
            this.clearSession('unauthorized_401');
          } else {
            this.recordLog('debug', 'FETCH_ME_UNAUTHORIZED', 'Guest visitor has no active session (401)');
          }
          return null;
        }

        if (!res.ok) {
          if (res.status >= 500 && attempt < 1) {
            this.recordLog('warn', 'FETCH_ME_TRANSIENT_ERROR', `Server returned ${res.status}; retrying once`, {
              status: res.status,
            });
            await new Promise((r) => setTimeout(r, 900));
            if (this.getToken() !== tokenAtStart) return this.currentUser;
            return exec(attempt + 1);
          }
          this.recordLog('warn', 'FETCH_ME_TRANSIENT_ERROR', `Preserving cached session after HTTP ${res.status}`, {
            status: res.status,
          });
          return this.currentUser;
        }

        const data = await this.readResponse(res);
        if (this.getToken() !== tokenAtStart) {
          this.recordLog('warn', 'FETCH_ME_SKIPPED_RACE', 'Token changed before /api/auth/me payload applied');
          return this.currentUser;
        }
        if (data.user) {
          const normUser = normalizeUser(data.user);
          if (data.token) {
            this.setSession(data.token, normUser, 'fetch_me', data.expiresAt);
          } else {
            if (typeof data.expiresAt === 'number' && Number.isFinite(data.expiresAt)) {
              this.expiresAt = data.expiresAt;
              safeStorageSet(EXPIRES_AT_KEY, String(data.expiresAt));
              this.scheduleTokenRefresh();
            }
            this.updateCachedUser(normUser, 'fetch_me_sync');
          }
          this.recordLog('info', 'FETCH_ME_SUCCESS', 'Session verified with backend', {
            refreshed: Boolean(data.refreshed),
            expiresAt: this.expiresAt,
          });
          if (this.shouldProactivelyRefresh() && !data.token) {
            void this.refreshToken('fetch_me_near_expiry');
          }
          return normUser;
        }
        return this.currentUser;
      } catch (e: any) {
        this.recordLog('warn', 'FETCH_ME_TRANSIENT_ERROR', 'Network error checking session; preserving local state', {
          error: e?.message || String(e),
        });
        return this.currentUser;
      }
    };

    const promise = exec(retryAttempt).finally(() => {
      if (this.fetchMeInFlight === promise) {
        this.fetchMeInFlight = null;
      }
    });

    if (retryAttempt === 0) {
      this.fetchMeInFlight = promise;
    }
    return promise;
  }

  public async register(payload: RegisterPayload): Promise<{ user: AuthUser; message: string }> {
    const rawEmail = payload.email.trim().toLowerCase();
    const derivedName = (payload.fullName || payload.name || rawEmail.split('@')[0] || 'Trader').trim();
    const reqBody = {
      email: rawEmail,
      phone: payload.phone.trim(),
      password: payload.password,
      confirmPassword: payload.confirmPassword || payload.password,
      fullName: derivedName,
      name: derivedName,
    };

    this.recordLog('info', 'REGISTER_ATTEMPT', 'Submitting account registration', { email: rawEmail });

    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(reqBody),
    });

    const data = await this.readResponse(res);
    if (!res.ok) {
      const msg = data.error || data.message || (typeof data === 'string' ? data : 'Registration failed');
      this.recordLog('warn', 'REGISTER_FAILURE', msg, { email: rawEmail, status: res.status });
      throw new Error(msg);
    }

    const normUser = normalizeUser(data.user);
    if (data.token && normUser) {
      this.setSession(data.token, normUser, 'register', data.expiresAt);
    }
    this.recordLog('info', 'REGISTER_SUCCESS', 'Account registered and session started', {
      email: normUser?.email,
      userId: normUser?.id,
    });

    return { user: normUser, message: data.message || 'Account registered successfully.' };
  }

  public async login(payload: LoginPayload): Promise<{ user: AuthUser; message: string }> {
    const rawId = payload.identifier.trim();
    const reqBody = {
      identifier: rawId,
      email: rawId,
      phone: rawId,
      password: payload.password,
    };

    this.recordLog('info', 'LOGIN_ATTEMPT', 'Submitting sign-in credentials', { identifier: rawId });

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(reqBody),
    });

    const data = await this.readResponse(res);
    if (!res.ok) {
      const msg = data.error || data.message || (typeof data === 'string' ? data : 'Login failed');
      this.recordLog('warn', 'LOGIN_FAILURE', msg, { identifier: rawId, status: res.status });
      throw new Error(msg);
    }

    const normUser = normalizeUser(data.user);
    if (data.token && normUser) {
      this.setSession(data.token, normUser, 'login', data.expiresAt);
    }
    this.recordLog('info', 'LOGIN_SUCCESS', 'Sign-in succeeded', {
      userId: normUser?.id,
      email: normUser?.email,
      role: normUser?.role,
    });

    return { user: normUser, message: data.message || 'Logged in successfully.' };
  }

  public async logout(): Promise<void> {
    const token = this.getToken();
    this.recordLog('info', 'LOGOUT_START', 'User initiated sign-out', {
      token: maskToken(token),
    });
    if (token) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: this.getAuthHeaders(),
          credentials: 'include',
        });
      } catch (e) {
        console.warn('Error reporting logout to server:', e);
      }
    }
    this.clearSession('explicit_logout');
    this.recordLog('info', 'LOGOUT_COMPLETE', 'Sign-out completed');
  }

  public async verifyEmail(code: string): Promise<AuthUser> {
    if (!this.isAuthenticated()) throw new Error('Authentication required');

    const res = await this.authorizedFetch(
      '/api/auth/verify-email',
      { method: 'POST', body: JSON.stringify({ code }) },
      { 'Content-Type': 'application/json' }
    );

    const data = await this.readResponse(res);
    if (!res.ok) {
      throw new Error(data.error || data.message || 'Email verification failed');
    }

    if (data.user) {
      const normUser = normalizeUser(data.user);
      this.updateCachedUser(normUser, 'verify_email');
      return normUser;
    }
    throw new Error('Verification response did not contain user data');
  }

  public async verifyPhone(code: string): Promise<AuthUser> {
    if (!this.isAuthenticated()) throw new Error('Authentication required');

    const res = await this.authorizedFetch(
      '/api/auth/verify-phone',
      { method: 'POST', body: JSON.stringify({ code }) },
      { 'Content-Type': 'application/json' }
    );

    const data = await this.readResponse(res);
    if (!res.ok) {
      throw new Error(data.error || data.message || 'Phone verification failed');
    }

    if (data.user) {
      const normUser = normalizeUser(data.user);
      this.updateCachedUser(normUser, 'verify_phone');
      return normUser;
    }
    throw new Error('Verification response did not contain user data');
  }

  public async resendCode(type: 'email' | 'phone'): Promise<{ message: string; user?: AuthUser }> {
    if (!this.isAuthenticated()) throw new Error('Authentication required');

    const res = await this.authorizedFetch(
      '/api/auth/resend-code',
      { method: 'POST', body: JSON.stringify({ type }) },
      { 'Content-Type': 'application/json' }
    );

    const data = await this.readResponse(res);
    if (!res.ok) {
      throw new Error(data.error || data.message || 'Failed to resend code');
    }

    if (data.user) {
      const normUser = normalizeUser(data.user);
      this.updateCachedUser(normUser, 'resend_code');
      return { message: data.message, user: normUser };
    }

    return { message: data.message, user: this.currentUser || undefined };
  }

  public async forgotPassword(identifier: string): Promise<{ message: string; devOtp?: string; deliveryConfigured?: boolean }> {
    const rawId = identifier.trim();
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ identifier: rawId, email: rawId, phone: rawId }),
    });

    const data = await this.readResponse(res);
    if (!res.ok) {
      throw new Error(data.error || data.message || 'Password reset request failed');
    }

    return {
      message: data.message,
      devOtp: data.devOtp,
      deliveryConfigured: data.deliveryConfigured,
    };
  }

  public async resetPassword(
    identifier: string,
    code: string,
    newPassword: string,
    confirmPassword?: string
  ): Promise<{ message: string }> {
    const rawId = identifier.trim();
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        identifier: rawId,
        email: rawId,
        phone: rawId,
        code,
        newPassword,
        confirmPassword,
      }),
    });

    const data = await this.readResponse(res);
    if (!res.ok) {
      throw new Error(data.error || data.message || 'Password reset failed');
    }

    return { message: data.message };
  }

  public async updateProfile(fields: {
    fullName?: string;
    country?: string;
    soundEnabled?: boolean;
    theme?: string;
  }): Promise<AuthUser> {
    if (!this.isAuthenticated()) throw new Error('Authentication required');

    const res = await this.authorizedFetch(
      '/api/user/profile',
      { method: 'PUT', body: JSON.stringify(fields) },
      { 'Content-Type': 'application/json' }
    );

    const data = await this.readResponse(res);
    if (!res.ok) {
      throw new Error(data.error || data.message || 'Profile update failed');
    }

    if (data.user) {
      const normUser = normalizeUser(data.user);
      this.updateCachedUser(normUser, 'profile_update');
      return normUser;
    }
    throw new Error('Profile update did not return user');
  }

  public async getTrades(): Promise<any[]> {
    if (!this.isAuthenticated()) return [];
    const res = await this.authorizedFetch('/api/user/trades');
    const data = await this.readResponse(res);
    if (!res.ok) throw new Error(data.error || 'Failed to load trade history');
    return Array.isArray(data.trades) ? data.trades : [];
  }

  public async getRiskProtection(): Promise<AdminRiskState | null> {
    if (!this.isAuthenticated()) {
      this.setRiskState(null);
      return null;
    }
    const res = await this.authorizedFetch('/api/user/risk-protection');
    const data = await this.readResponse(res);
    if (!res.ok) throw new Error(data.error || 'Could not load risk protection status');
    const rs = (data.riskState as AdminRiskState | null) ?? null;
    this.setRiskState(rs);
    return rs;
  }

  public async startBotRiskSession(maxLoss: number, mode: 'demo' | 'real'): Promise<AdminRiskState | null> {
    if (!this.isAuthenticated()) return null;
    const res = await this.authorizedFetch(
      '/api/user/risk-protection/start',
      { method: 'POST', body: JSON.stringify({ maxLoss, mode }) },
      { 'Content-Type': 'application/json' }
    );
    const data = await this.readResponse(res);
    if (data.riskState !== undefined) {
      this.setRiskState(data.riskState as AdminRiskState | null);
    }
    if (!res.ok) throw new Error(data.error || 'Could not initialize risk-protected session');
    return (data.riskState as AdminRiskState | null) ?? null;
  }

  public async resetRiskControlPeriod(maxLoss?: number): Promise<AdminRiskState | null> {
    if (!this.isAuthenticated()) throw new Error('Authentication required');
    const res = await this.authorizedFetch(
      '/api/user/risk-protection/reset-period',
      {
        method: 'POST',
        body: JSON.stringify({
          confirmReset: true,
          ...(maxLoss !== undefined ? { maxLoss } : {}),
        }),
      },
      { 'Content-Type': 'application/json' }
    );
    const data = await this.readResponse(res);
    if (data.riskState !== undefined) {
      this.setRiskState(data.riskState as AdminRiskState | null);
    }
    if (!res.ok) throw new Error(data.error || 'Could not reset risk-control period');
    return (data.riskState as AdminRiskState | null) ?? null;
  }

  public async stopBotRiskSession(): Promise<AdminRiskState | null> {
    if (!this.isAuthenticated()) return null;
    const res = await this.authorizedFetch(
      '/api/user/risk-protection/stop',
      { method: 'POST' },
      { 'Content-Type': 'application/json' }
    );
    const data = await this.readResponse(res);
    if (!res.ok) return this.lastRiskState;
    const rs = (data.riskState as AdminRiskState | null) ?? null;
    this.setRiskState(rs);
    return rs;
  }

  public async syncRiskConfig(params: { mode?: 'demo' | 'real'; maxLoss?: number }): Promise<AdminRiskState | null> {
    if (!this.isAuthenticated()) return null;
    const res = await this.authorizedFetch(
      '/api/user/risk-protection/config',
      { method: 'POST', body: JSON.stringify(params) },
      { 'Content-Type': 'application/json' }
    );
    const data = await this.readResponse(res);
    if (!res.ok) return this.lastRiskState;
    const rs = (data.riskState as AdminRiskState | null) ?? null;
    this.setRiskState(rs);
    return rs;
  }

  public async placeTrade(trade: any, mode: 'demo' | 'real'): Promise<{ demoBalance: number; realBalance: number }> {
    if (!this.isAuthenticated()) throw new Error('Authentication required');
    const res = await this.authorizedFetch(
      '/api/user/trades/place',
      { method: 'POST', body: JSON.stringify({ trade, mode }) },
      { 'Content-Type': 'application/json' }
    );
    const data = await this.readResponse(res);
    if (data.riskState !== undefined) {
      this.setRiskState(data.riskState as AdminRiskState | null);
    }
    if (!res.ok) throw new Error(data.error || 'Could not place trade');
    if (this.currentUser && data.balances) {
      this.updateCachedUser({ ...this.currentUser, ...data.balances }, 'trade_placed_balance_sync');
    }
    return data.balances;
  }

  public async settleTrade(trade: any): Promise<{ demoBalance: number; realBalance: number }> {
    if (!this.isAuthenticated()) throw new Error('Authentication required');
    const res = await this.authorizedFetch(
      `/api/user/trades/${encodeURIComponent(trade.id)}/settle`,
      { method: 'POST', body: JSON.stringify(trade) },
      { 'Content-Type': 'application/json' }
    );
    const data = await this.readResponse(res);
    if (data.riskState !== undefined) {
      this.setRiskState(data.riskState as AdminRiskState | null);
    }
    if (!res.ok) throw new Error(data.error || 'Could not settle trade');
    if (this.currentUser && data.balances) {
      this.updateCachedUser({ ...this.currentUser, ...data.balances }, 'trade_settled_balance_sync');
    }
    return data.balances;
  }

  public async saveTrade(trade: any): Promise<void> {
    if (!this.isAuthenticated()) return;
    const res = await this.authorizedFetch(
      '/api/user/trades',
      { method: 'POST', body: JSON.stringify(trade) },
      { 'Content-Type': 'application/json' }
    );
    const data = await this.readResponse(res);
    if (!res.ok) throw new Error(data.error || 'Failed to save trade');
  }

  public isAdmin(): boolean {
    return this.currentUser?.role === 'admin';
  }

  // ─────────────────────────────────────────────────────────────
  // ADMINISTRATOR API METHODS
  // ─────────────────────────────────────────────────────────────

  public async getAdminOverview(): Promise<AdminOverviewResponse> {
    if (!this.isAuthenticated()) throw new Error('Authentication required');

    const res = await this.authorizedFetch('/api/admin/overview');

    const data = await this.readResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Failed to fetch admin overview');
    }
    return data;
  }

  public async getAdminUsers(): Promise<AdminUserRecord[]> {
    if (!this.isAuthenticated()) throw new Error('Authentication required');

    const res = await this.authorizedFetch('/api/admin/users');

    const data = await this.readResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Failed to load user directory');
    }
    return data.users;
  }

  public async updateUserRole(userId: string, role: 'admin' | 'user'): Promise<AuthUser> {
    if (!this.isAuthenticated()) throw new Error('Authentication required');

    const res = await this.authorizedFetch(
      `/api/admin/users/${userId}/role`,
      { method: 'POST', body: JSON.stringify({ role }) },
      { 'Content-Type': 'application/json' }
    );

    const data = await this.readResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Failed to update user role');
    }

    if (userId === this.currentUser?.id && data.user) {
      this.updateCachedUser(data.user, 'admin_self_role_update');
    }

    return data.user;
  }

  public async adjustUserBalance(
    userId: string,
    accountType: 'demo' | 'real',
    amount: number,
    operation: 'add' | 'set' = 'add'
  ): Promise<AuthUser> {
    if (!this.isAuthenticated()) throw new Error('Authentication required');

    const res = await this.authorizedFetch(
      `/api/admin/users/${userId}/balance`,
      { method: 'POST', body: JSON.stringify({ accountType, amount, operation }) },
      { 'Content-Type': 'application/json' }
    );

    const data = await this.readResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Failed to adjust balance');
    }

    if (userId === this.currentUser?.id && data.user) {
      this.updateCachedUser(data.user, 'admin_self_balance_update');
    }

    return data.user;
  }

  public async createAdminAccount(payload: {
    email: string;
    phone?: string;
    password: string;
    fullName?: string;
  }): Promise<AuthUser> {
    if (!this.isAuthenticated()) throw new Error('Authentication required');

    const res = await this.authorizedFetch(
      '/api/admin/create-admin',
      { method: 'POST', body: JSON.stringify(payload) },
      { 'Content-Type': 'application/json' }
    );

    const data = await this.readResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Failed to create admin account');
    }
    return data.user;
  }

  public async deleteUser(userId: string): Promise<void> {
    if (!this.isAuthenticated()) throw new Error('Authentication required');

    const res = await this.authorizedFetch(`/api/admin/users/${userId}`, {
      method: 'DELETE',
    });

    const data = await this.readResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Failed to delete user');
    }
  }

  public dispose(): void {
    this.clearRefreshTimer();
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('storage', this.handleCrossTabStorageEvent);
    }
  }
}

export const authClient = new AuthClient();

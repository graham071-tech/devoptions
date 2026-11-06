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
}

export interface LoginPayload {
  identifier: string; // email or phone
  password: string;
}

const TOKEN_KEY = 'devoptions_auth_token';
const USER_KEY = 'devoptions_auth_user';

class AuthClient {
  private token: string | null = null;
  private currentUser: AuthUser | null = null;
  private listeners: ((user: AuthUser | null) => void)[] = [];

  constructor() {
    this.token = localStorage.getItem(TOKEN_KEY);
    const cachedUser = localStorage.getItem(USER_KEY);
    if (cachedUser) {
      try {
        this.currentUser = JSON.parse(cachedUser);
      } catch (e) {
        this.currentUser = null;
      }
    }
  }

  public getToken(): string | null {
    if (!this.token) {
      this.token = localStorage.getItem(TOKEN_KEY);
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
      const cached = localStorage.getItem(USER_KEY);
      if (cached) {
        try {
          this.currentUser = JSON.parse(cached);
        } catch {
          this.currentUser = null;
        }
      }
    }
    return this.currentUser;
  }

  public isAuthenticated(): boolean {
    return !!this.getToken() && !!this.getCurrentUser();
  }

  public subscribe(cb: (user: AuthUser | null) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
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

  private notify() {
    for (const listener of this.listeners) {
      listener(this.currentUser);
    }
  }

  private setSession(token: string, user: AuthUser) {
    this.token = token;
    this.currentUser = user;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    this.notify();
  }

  public clearSession() {
    this.token = null;
    this.currentUser = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this.notify();
  }

  public async fetchMe(): Promise<AuthUser | null> {
    const token = this.getToken();
    if (!token) {
      this.clearSession();
      return null;
    }

    try {
      const res = await fetch('/api/auth/me', {
        method: 'GET',
        headers: this.getAuthHeaders(),
        credentials: 'include',
      });

      if (!res.ok) {
        this.clearSession();
        return null;
      }

      const data = await this.readResponse(res);
      if (data.user) {
        this.currentUser = data.user;
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        this.notify();
        return data.user;
      }
      return null;
    } catch (e) {
      console.warn('Network issue fetching current user session:', e);
      return this.currentUser;
    }
  }

  public async register(payload: RegisterPayload): Promise<{ user: AuthUser; message: string }> {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });

    const data = await this.readResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Registration failed');
    }

    if (data.token && data.user) {
      this.setSession(data.token, data.user);
    }

    return { user: data.user, message: data.message };
  }

  public async login(payload: LoginPayload): Promise<{ user: AuthUser; message: string }> {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });

    const data = await this.readResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Login failed');
    }

    if (data.token && data.user) {
      this.setSession(data.token, data.user);
    }

    return { user: data.user, message: data.message };
  }

  public async logout(): Promise<void> {
    const token = this.getToken();
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
    this.clearSession();
  }

  public async verifyEmail(code: string): Promise<AuthUser> {
    if (!this.getToken()) throw new Error('Authentication required');

    const res = await fetch('/api/auth/verify-email', {
      method: 'POST',
      headers: this.getAuthHeaders({
        'Content-Type': 'application/json',
      }),
      credentials: 'include',
      body: JSON.stringify({ code }),
    });

    const data = await this.readResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Email verification failed');
    }

    if (data.user) {
      this.currentUser = data.user;
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      this.notify();
      return data.user;
    }
    throw new Error('Verification response did not contain user data');
  }

  public async verifyPhone(code: string): Promise<AuthUser> {
    if (!this.getToken()) throw new Error('Authentication required');

    const res = await fetch('/api/auth/verify-phone', {
      method: 'POST',
      headers: this.getAuthHeaders({
        'Content-Type': 'application/json',
      }),
      credentials: 'include',
      body: JSON.stringify({ code }),
    });

    const data = await this.readResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Phone verification failed');
    }

    if (data.user) {
      this.currentUser = data.user;
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      this.notify();
      return data.user;
    }
    throw new Error('Verification response did not contain user data');
  }

  public async resendCode(type: 'email' | 'phone'): Promise<{ message: string; user?: AuthUser }> {
    if (!this.getToken()) throw new Error('Authentication required');

    const res = await fetch('/api/auth/resend-code', {
      method: 'POST',
      headers: this.getAuthHeaders({
        'Content-Type': 'application/json',
      }),
      credentials: 'include',
      body: JSON.stringify({ type }),
    });

    const data = await this.readResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Failed to resend code');
    }

    if (data.user) {
      this.currentUser = data.user;
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      this.notify();
    }

    return { message: data.message, user: data.user };
  }

  public async forgotPassword(identifier: string): Promise<{ message: string; devOtp?: string }> {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ identifier }),
    });

    const data = await this.readResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Password reset request failed');
    }

    return { message: data.message, devOtp: data.devOtp };
  }

  public async resetPassword(
    identifier: string,
    code: string,
    newPassword: string,
    confirmPassword?: string
  ): Promise<{ message: string }> {
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ identifier, code, newPassword, confirmPassword }),
    });

    const data = await this.readResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Password reset failed');
    }

    return { message: data.message };
  }

  public async updateProfile(fields: {
    fullName?: string;
    country?: string;
    soundEnabled?: boolean;
    theme?: string;
  }): Promise<AuthUser> {
    if (!this.getToken()) throw new Error('Authentication required');

    const res = await fetch('/api/user/profile', {
      method: 'PUT',
      headers: this.getAuthHeaders({
        'Content-Type': 'application/json',
      }),
      credentials: 'include',
      body: JSON.stringify(fields),
    });

    const data = await this.readResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Profile update failed');
    }

    if (data.user) {
      this.currentUser = data.user;
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      this.notify();
      return data.user;
    }
    throw new Error('Profile update did not return user');
  }

  public async getTrades(): Promise<any[]> {
    if (!this.getToken()) return [];
    const res = await fetch('/api/user/trades', {
      headers: this.getAuthHeaders(),
      credentials: 'include',
    });
    const data = await this.readResponse(res);
    if (!res.ok) throw new Error(data.error || 'Failed to load trade history');
    return Array.isArray(data.trades) ? data.trades : [];
  }

  public async placeTrade(trade: any, mode: 'demo' | 'real'): Promise<{ demoBalance: number; realBalance: number }> {
    if (!this.getToken()) throw new Error('Authentication required');
    const res = await fetch('/api/user/trades/place', {
      method: 'POST',
      headers: this.getAuthHeaders({ 'Content-Type': 'application/json' }),
      credentials: 'include',
      body: JSON.stringify({ trade, mode }),
    });
    const data = await this.readResponse(res);
    if (!res.ok) throw new Error(data.error || 'Could not place trade');
    if (this.currentUser && data.balances) {
      this.currentUser = { ...this.currentUser, ...data.balances };
      localStorage.setItem(USER_KEY, JSON.stringify(this.currentUser));
      this.notify();
    }
    return data.balances;
  }

  public async settleTrade(trade: any): Promise<{ demoBalance: number; realBalance: number }> {
    if (!this.getToken()) throw new Error('Authentication required');
    const res = await fetch(`/api/user/trades/${encodeURIComponent(trade.id)}/settle`, {
      method: 'POST',
      headers: this.getAuthHeaders({ 'Content-Type': 'application/json' }),
      credentials: 'include',
      body: JSON.stringify(trade),
    });
    const data = await this.readResponse(res);
    if (!res.ok) throw new Error(data.error || 'Could not settle trade');
    if (this.currentUser && data.balances) {
      this.currentUser = { ...this.currentUser, ...data.balances };
      localStorage.setItem(USER_KEY, JSON.stringify(this.currentUser));
      this.notify();
    }
    return data.balances;
  }

  public async saveTrade(trade: any): Promise<void> {
    if (!this.getToken()) return;
    const res = await fetch('/api/user/trades', {
      method: 'POST',
      headers: this.getAuthHeaders({ 'Content-Type': 'application/json' }),
      credentials: 'include',
      body: JSON.stringify(trade),
    });
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
    if (!this.getToken()) throw new Error('Authentication required');

    const res = await fetch('/api/admin/overview', {
      headers: this.getAuthHeaders(),
      credentials: 'include',
    });

    const data = await this.readResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Failed to fetch admin overview');
    }
    return data;
  }

  public async getAdminUsers(): Promise<AdminUserRecord[]> {
    if (!this.getToken()) throw new Error('Authentication required');

    const res = await fetch('/api/admin/users', {
      headers: this.getAuthHeaders(),
      credentials: 'include',
    });

    const data = await this.readResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Failed to load user directory');
    }
    return data.users;
  }

  public async updateUserRole(userId: string, role: 'admin' | 'user'): Promise<AuthUser> {
    if (!this.getToken()) throw new Error('Authentication required');

    const res = await fetch(`/api/admin/users/${userId}/role`, {
      method: 'POST',
      headers: this.getAuthHeaders({
        'Content-Type': 'application/json',
      }),
      credentials: 'include',
      body: JSON.stringify({ role }),
    });

    const data = await this.readResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Failed to update user role');
    }

    if (userId === this.currentUser?.id && data.user) {
      this.currentUser = data.user;
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      this.notify();
    }

    return data.user;
  }

  public async adjustUserBalance(
    userId: string,
    accountType: 'demo' | 'real',
    amount: number,
    operation: 'add' | 'set' = 'add'
  ): Promise<AuthUser> {
    if (!this.getToken()) throw new Error('Authentication required');

    const res = await fetch(`/api/admin/users/${userId}/balance`, {
      method: 'POST',
      headers: this.getAuthHeaders({
        'Content-Type': 'application/json',
      }),
      credentials: 'include',
      body: JSON.stringify({ accountType, amount, operation }),
    });

    const data = await this.readResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Failed to adjust balance');
    }

    if (userId === this.currentUser?.id && data.user) {
      this.currentUser = data.user;
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      this.notify();
    }

    return data.user;
  }

  public async createAdminAccount(payload: {
    email: string;
    phone?: string;
    password: string;
    fullName?: string;
  }): Promise<AuthUser> {
    if (!this.getToken()) throw new Error('Authentication required');

    const res = await fetch('/api/admin/create-admin', {
      method: 'POST',
      headers: this.getAuthHeaders({
        'Content-Type': 'application/json',
      }),
      credentials: 'include',
      body: JSON.stringify(payload),
    });

    const data = await this.readResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Failed to create admin account');
    }
    return data.user;
  }

  public async deleteUser(userId: string): Promise<void> {
    if (!this.getToken()) throw new Error('Authentication required');

    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders(),
      credentials: 'include',
    });

    const data = await this.readResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Failed to delete user');
    }
  }
}

export const authClient = new AuthClient();

import { authClient } from './authClient';

export interface PaynectaConfigResponse {
  configured: boolean;
  missingKeys: string[];
  currency: string;
  kesPerUsd: number;
  minDepositUsd: number;
  minDepositKes: number;
  tapFlowConfigured: boolean;
  liveNotice: string;
}

export interface PaynectaDeposit {
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

export interface CreateDepositResponse {
  message: string;
  deposit: {
    id: string;
    merchantReference: string;
    amountKes: number;
    amountUsd: number;
    currency: string;
    checkoutUrl: string;
    status: string;
    createdAt: number;
  };
}

export interface VerifyDepositResponse {
  status: 'succeeded' | 'pending' | 'failed' | 'cancelled' | 'verification_delayed';
  deposit: PaynectaDeposit;
  realBalance?: number;
  message: string;
  alreadyCredited?: boolean;
}

class PaynectaClient {
  private getAuthHeaders(): HeadersInit {
    const token = authClient.getToken();
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(token
        ? {
            Authorization: `Bearer ${token}`,
            'x-auth-token': token,
          }
        : {}),
    };
  }

  /**
   * Fetch gateway configuration and server environment readiness
   */
  public async getConfig(): Promise<PaynectaConfigResponse> {
    try {
      const res = await fetch('/api/paynecta/config', {
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error(`Failed to load payment configuration (${res.status})`);
      }
      return await res.json();
    } catch (err: any) {
      console.warn('[PaynectaClient] Config fetch error:', err.message);
      return {
        configured: false,
        missingKeys: ['PAYNECTA_SECRET_KEY', 'PAYNECTA_TAPFLOW_ID'],
        currency: 'KES',
        kesPerUsd: 130.0,
        minDepositUsd: 5.0,
        minDepositKes: 650,
        tapFlowConfigured: false,
        liveNotice: 'Paynecta operates with live M-Pesa collections in whole Kenyan Shillings (KES).',
      };
    }
  }

  /**
   * Request a new Paynecta checkout session on the backend
   */
  public async createDeposit(amountKes: number): Promise<CreateDepositResponse> {
    const res = await fetch('/api/paynecta/create-deposit', {
      method: 'POST',
      headers: this.getAuthHeaders(),
      credentials: 'include',
      body: JSON.stringify({ amountKes }),
    });

    let data: any = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }

    if (!res.ok) {
      let friendlyMessage = data.message || data.error;
      const code = data.code || (res.status === 401 ? 'AUTH_REQUIRED' : undefined);

      if (res.status === 401) {
        if (code === 'SESSION_EXPIRED') {
          friendlyMessage = 'Your session has expired. Please log in again.';
        } else if (code === 'INVALID_TOKEN') {
          friendlyMessage = 'Authentication could not be verified.';
        } else if (code === 'ACCOUNT_INACTIVE') {
          friendlyMessage = 'Contact support for assistance.';
        } else {
          friendlyMessage = 'Please log in to continue.';
        }
      } else if (res.status === 403) {
        friendlyMessage = 'Contact support for assistance.';
      } else if (
        code === 'TAPFLOW_MISSING' ||
        friendlyMessage?.includes('No active payment collection flow was found')
      ) {
        friendlyMessage =
          'Paynecta setup incomplete. No active payment collection flow was found. Please configure or activate a TapFlow in your Paynecta account.';
      } else if (res.status === 503 || code === 'CONFIG_MISSING') {
        friendlyMessage = data.message || 'Payment service setup is incomplete.';
      } else if (code === 'PAYNECTA_AUTH_FAILED') {
        friendlyMessage = data.message || 'Paynecta API Authentication Failed. Please verify your secret key.';
      } else if (res.status === 502 || code === 'PAYNECTA_UNAVAILABLE') {
        friendlyMessage = data.message || 'Payment service is temporarily unavailable.';
      }

      const err = new Error(friendlyMessage || 'Failed to initiate payment session.') as any;
      err.code = code;
      err.status = res.status;
      err.missing = data.missing;
      err.help = data.help;
      throw err;
    }

    if (!data || typeof data !== 'object' || !data.deposit || typeof data.deposit !== 'object' || !data.deposit.id) {
      const err = new Error(data?.message || data?.error || 'Payment gateway returned an invalid or missing deposit record.') as any;
      err.code = 'INVALID_RESPONSE';
      throw err;
    }

    return data;
  }

  /**
   * Independently verify the payment outcome with the backend
   */
  public async verifyDeposit(depositId: string): Promise<VerifyDepositResponse> {
    const res = await fetch(`/api/paynecta/verify-deposit/${encodeURIComponent(depositId)}`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      credentials: 'include',
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || data.error || 'Failed to verify payment status.');
    }

    return data;
  }

  /**
   * Fetch user's deposit history
   */
  public async getDepositHistory(): Promise<PaynectaDeposit[]> {
    const res = await fetch('/api/paynecta/deposits', {
      method: 'GET',
      headers: this.getAuthHeaders(),
      credentials: 'include',
    });

    if (!res.ok) {
      return [];
    }

    const data = await res.json();
    return data.deposits || [];
  }

  /**
   * Cancel an existing pending deposit
   */
  public async cancelDeposit(depositId: string): Promise<void> {
    await fetch(`/api/paynecta/cancel-deposit/${encodeURIComponent(depositId)}`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      credentials: 'include',
    });
  }

  /**
   * Fetch usable TapFlows from server
   */
  public async getTapFlows(): Promise<any[]> {
    try {
      const res = await fetch('/api/paynecta/tapflows', {
        method: 'GET',
        headers: this.getAuthHeaders(),
        credentials: 'include',
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.tapflows || [];
    } catch {
      return [];
    }
  }
}

export const paynectaClient = new PaynectaClient();


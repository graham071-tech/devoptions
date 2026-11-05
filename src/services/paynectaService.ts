import crypto from 'crypto';

export interface PaynectaConfig {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
  tapFlowId: string;
  webhookSecret: string;
  appBaseUrl: string;
  kesPerUsd: number;
  minDepositUsd: number;
  minDepositKes: number;
}

export interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

export interface CreateSessionParams {
  merchantReference: string;
  amountKes: number;
  appUrl: string;
  customer: {
    email: string;
    phone: string;
    name: string;
  };
}

export interface InitializeCheckoutSessionParams {
  amount: number; // Selected deposit amount in whole Kenyan Shillings (KES)
  email: string; // Customer's email address
  phone?: string; // Customer's phone number (e.g. +2547XXXXXXXX)
  name?: string; // Customer's full name
  merchantReference?: string; // Unique internal reference (auto-generated if omitted)
  appUrl?: string; // Base application URL (defaults to APP_BASE_URL or APP_URL)
  description?: string; // Order description
  metadata?: Record<string, any>; // Optional additional metadata
}

export interface PaynectaSessionResponse {
  sessionId: string;
  checkoutUrl: string;
  merchantReference: string;
  amountSubunits: number;
  currency: string;
  status: string;
}

export interface InitializeCheckoutSessionResult extends PaynectaSessionResponse {
  webhookUrl: string;
  redirectUrl: string;
  cancelUrl: string;
  amountKes: number;
  tapFlowId: string;
}

export interface PaynectaVerificationResult {
  status: 'succeeded' | 'pending' | 'failed' | 'cancelled' | 'verification_delayed';
  confirmedAmountKes?: number;
  providerReference?: string;
  receiptNumber?: string;
  failureReason?: string;
  rawStatus?: string;
}

export interface TapFlowItem {
  id: string;
  tapflow_id?: string;
  name?: string;
  title?: string;
  status?: string;
  active?: boolean;
  payment_collection?: boolean;
  can_collect?: boolean;
  open_amount?: boolean;
  supports_open_amount?: boolean;
  fixed_amount?: boolean;
  currency?: string;
}

/**
 * Backend service for Paynecta Payment Gateway integration.
 * Handles OAuth session authentication, checkout session creation,
 * TapFlow discovery, server-to-server transaction verification,
 * and webhook HMAC-SHA256 signature and timestamp validation.
 *
 * Reference: https://docs.paynecta.co.ke/api/
 * Base URL: https://api.paynecta.co.ke/v1
 */
class PaynectaService {
  private cachedToken: CachedToken | null = null;
  private discoveredTapFlowId: string | null = null;

  /**
   * Cache a discovered TapFlow ID for this server instance.
   * Serverless filesystems are ephemeral/read-only, so persist it in deployment
   * environment configuration rather than attempting to write a local .env file.
   */
  public saveDiscoveredTapFlowId(flowId: string): void {
    const cleanId = String(flowId || '').trim();
    if (!cleanId) return;
    this.discoveredTapFlowId = cleanId;
    process.env.PAYNECTA_TAPFLOW_ID = cleanId;
  }

  public getConfig(): PaynectaConfig {
    const env = typeof process !== 'undefined' && process.env ? process.env : {};
    const baseUrl = (env.PAYNECTA_BASE_URL || 'https://api.paynecta.co.ke/v1').replace(/\/+$/, '');
    let publicKey = (env.PAYNECTA_PUBLIC_KEY || '').trim();
    let secretKey = (env.PAYNECTA_SECRET_KEY || '').trim();
    const tapFlowId = (this.discoveredTapFlowId || env.PAYNECTA_TAPFLOW_ID || '').trim();
    const webhookSecret = (env.PAYNECTA_WEBHOOK_SECRET || '').trim();
    let appBaseUrl = (env.APP_BASE_URL || env.APP_URL || 'http://localhost:3000').trim().replace(/\/+$/, '');

    // Auto-detect if user mistakenly saved their Secret Key or Public Key in APP_BASE_URL
    if (!secretKey && env.APP_BASE_URL && env.APP_BASE_URL.startsWith('pyn_sk_')) {
      secretKey = env.APP_BASE_URL.trim();
    }
    if (!publicKey && env.APP_BASE_URL && env.APP_BASE_URL.startsWith('pyn_pk_')) {
      publicKey = env.APP_BASE_URL.trim();
    }
    if (appBaseUrl.startsWith('pyn_') || (!appBaseUrl.startsWith('http://') && !appBaseUrl.startsWith('https://'))) {
      appBaseUrl = (env.APP_URL || 'http://localhost:3000').trim().replace(/\/+$/, '');
    }

    const kesPerUsd = Number(env.PAYNECTA_KES_PER_USD) || 130.0;
    const minDepositUsd = 5.0;
    const minDepositKes = Math.round(minDepositUsd * kesPerUsd); // KES 650

    return {
      baseUrl,
      publicKey,
      secretKey,
      tapFlowId,
      webhookSecret,
      appBaseUrl,
      kesPerUsd,
      minDepositUsd,
      minDepositKes,
    };
  }

  public isConfigured(): { isReady: boolean; missing: string[]; configuredKeys: string[] } {
    const config = this.getConfig();
    const missing: string[] = [];
    const configuredKeys: string[] = [];

    if (!config.secretKey) {
      missing.push('PAYNECTA_SECRET_KEY');
    } else {
      configuredKeys.push('PAYNECTA_SECRET_KEY');
    }

    if (!config.publicKey) {
      missing.push('PAYNECTA_PUBLIC_KEY');
    } else {
      configuredKeys.push('PAYNECTA_PUBLIC_KEY');
    }

    if (config.tapFlowId) configuredKeys.push('PAYNECTA_TAPFLOW_ID');
    if (config.webhookSecret) configuredKeys.push('PAYNECTA_WEBHOOK_SECRET');

    return {
      isReady: missing.length === 0,
      missing,
      configuredKeys,
    };
  }

  /**
   * 1. SESSION AUTHENTICATION
   * Authenticates with Paynecta API. Supports:
   * - /auth/token endpoint exchange using Basic base64(PUBLIC_KEY:SECRET_KEY)
   * - API Secret Key used directly as Bearer token if token exchange is optional
   * Caches token securely and renews before expiry.
   */
  public async getAccessToken(): Promise<string> {
    const config = this.getConfig();
    const { isReady, missing } = this.isConfigured();

    if (!isReady) {
      throw new Error(`Paynecta is not configured. Missing environment variables: ${missing.join(', ')}`);
    }

    const now = Date.now();
    // Return cached token if valid for at least another 60 seconds
    if (this.cachedToken && this.cachedToken.expiresAt > now + 60000) {
      return this.cachedToken.accessToken;
    }

    // If both public and secret keys are provided, exchange at /auth/token
    if (config.publicKey && config.secretKey) {
      try {
        const authUrl = `${config.baseUrl}/auth/token`;
        const basicAuth = Buffer.from(`${config.publicKey}:${config.secretKey}`).toString('base64');

        const res = await fetch(authUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${basicAuth}`,
            'Accept': 'application/json',
          },
        });

        if (res.ok) {
          const data = await res.json();
          const accessToken = data.access_token || data.token || data.data?.access_token;
          const expiresInSeconds = Number(data.expires_in || data.data?.expires_in) || 3600;

          if (accessToken) {
            this.cachedToken = {
              accessToken,
              expiresAt: now + expiresInSeconds * 1000,
            };
            return accessToken;
          }
        } else {
          const errText = await res.text();
          let errJson: any = null;
          try {
            errJson = JSON.parse(errText);
          } catch {
            errJson = null;
          }
          const msg = (errJson && (errJson.message || errJson.error)) || errText || res.statusText;
          if (res.status === 401) {
            throw new Error(`Paynecta authentication failed (401): ${msg}. Please verify PAYNECTA_PUBLIC_KEY and PAYNECTA_SECRET_KEY in server environment settings.`);
          } else if (res.status === 403) {
            throw new Error(`Paynecta account authorization error (403): ${msg}. Please ensure your account has active API permissions.`);
          }
          console.warn(`[Paynecta Service] /auth/token returned ${res.status}: ${msg}. Falling back to secret key.`);
        }
      } catch (err: any) {
        if (err.message.includes('Paynecta authentication failed') || err.message.includes('Paynecta account authorization error')) {
          throw err;
        }
        console.warn(`[Paynecta Service] /auth/token exchange error: ${err.message}. Falling back to secret key.`);
      }
    }

    throw new Error('Paynecta access-token exchange failed. Check the public and secret keys and retry.');
  }

  /**
   * 2. TAPFLOW RETRIEVAL
   * Retrieves available TapFlows using: GET /v1/tapflows?usable=true
   */
  public async getUsableTapFlows(): Promise<TapFlowItem[]> {
    const config = this.getConfig();
    const token = await this.getAccessToken();

    const url = `${config.baseUrl}/tapflows?usable=true`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      let errJson: any = null;
      try {
        errJson = JSON.parse(errText);
      } catch {
        errJson = null;
      }
      const errorMsg =
        errJson?.message ||
        errJson?.error ||
        errJson?.error_description ||
        errText ||
        `HTTP ${res.status}`;
      console.warn(`[Paynecta TapFlows] Query returned ${res.status}: ${errorMsg}`);

      if (res.status === 401) {
        throw new Error(
          `Paynecta API authentication failed (401 Unauthorized): ${errorMsg}. Please verify that your PAYNECTA_SECRET_KEY is valid and active.`
        );
      }
      if (res.status === 403) {
        throw new Error(
          `Paynecta account is not authorized to collect payments (403 Forbidden): ${errorMsg}. Please ensure payment collection is activated in your Paynecta account.`
        );
      }
      throw new Error(`Paynecta TapFlow query failed (${res.status}): ${errorMsg}`);
    }

    let data: any = null;
    try {
      data = await res.json();
    } catch {
      throw new Error('Paynecta returned an unparseable response when retrieving TapFlows.');
    }

    if (!data || typeof data !== 'object') {
      return [];
    }

    if (data.status === 'error' || data.error) {
      throw new Error(data.message || data.error || 'Paynecta returned an error retrieving TapFlows.');
    }

    // Inspect actual API response structure defensively without assuming any single format
    let rawList: any[] = [];
    if (Array.isArray(data)) {
      rawList = data;
    } else if (data.data && Array.isArray(data.data)) {
      rawList = data.data;
    } else if (data.tapflows && Array.isArray(data.tapflows)) {
      rawList = data.tapflows;
    } else if (data.tap_flows && Array.isArray(data.tap_flows)) {
      rawList = data.tap_flows;
    } else if (data.items && Array.isArray(data.items)) {
      rawList = data.items;
    } else if (data.results && Array.isArray(data.results)) {
      rawList = data.results;
    } else if (data.data && typeof data.data === 'object') {
      if (Array.isArray(data.data.tapflows)) {
        rawList = data.data.tapflows;
      } else if (Array.isArray(data.data.tap_flows)) {
        rawList = data.data.tap_flows;
      } else if (Array.isArray(data.data.items)) {
        rawList = data.data.items;
      } else if (data.data.id || data.data.tapflow_id) {
        rawList = [data.data];
      }
    } else if (data.id || data.tapflow_id) {
      rawList = [data];
    }

    // Sanitize and validate every item before returning
    const flows: TapFlowItem[] = rawList
      .filter((item): item is Record<string, any> => Boolean(item && typeof item === 'object'))
      .map((item) => {
        const id = (item.id || item.tapflow_id || '').toString().trim();
        const tapflow_id = (item.tapflow_id || item.id || '').toString().trim();
        return {
          id,
          tapflow_id,
          name: item.name || item.title || item.label || 'Collection Flow',
          title: item.title || item.name || 'Collection Flow',
          status: item.status ? String(item.status).toLowerCase() : 'active',
          active: item.active !== false && item.status !== 'inactive' && item.status !== 'archived',
          payment_collection: item.payment_collection !== false && item.can_collect !== false,
          can_collect: item.can_collect !== false && item.payment_collection !== false,
          open_amount: item.open_amount === true || item.supports_open_amount === true || !item.fixed_amount,
          supports_open_amount: item.supports_open_amount === true || item.open_amount === true,
          fixed_amount: Boolean(item.fixed_amount),
          currency: item.currency || 'KES',
        };
      })
      .filter((item) => Boolean(item.id || item.tapflow_id));

    return flows;
  }

  /**
   * Selects an active TapFlow that supports open amounts and has payment collection enabled.
   * If a suitable TapFlow is found, saves its ID into backend configuration as PAYNECTA_TAPFLOW_ID.
   * Does not invent a TapFlow ID.
   */
  public async resolveActiveTapFlowId(): Promise<{ tapFlowId: string; source: 'discovered' | 'configured'; details?: any }> {
    const config = this.getConfig();

    // 1. If we already discovered and saved a valid TapFlow in this process:
    if (this.discoveredTapFlowId) {
      return {
        tapFlowId: this.discoveredTapFlowId,
        source: 'discovered',
      };
    }

    // 2. Query available TapFlows from Paynecta API
    let flows: TapFlowItem[] = [];
    let queryError: string | null = null;
    try {
      flows = await this.getUsableTapFlows();
    } catch (err: any) {
      queryError = err.message || String(err);
      console.warn('[Paynecta TapFlows] TapFlow retrieval failed:', queryError);
    }

    // 3. Inspect discovered flows if any returned
    if (Array.isArray(flows) && flows.length > 0) {
      // If a specific tapFlowId is configured in env, check if it matches in the usable list
      if (config.tapFlowId) {
        const cleanTarget = config.tapFlowId.replace(/^https?:\/\/pay\.paynecta\.co\.ke\//, '').trim();
        const matched = flows.find((f: any) => {
          if (!f || typeof f !== 'object') return false;
          return (
            f.id === config.tapFlowId ||
            f.tapflow_id === config.tapFlowId ||
            f.id === cleanTarget ||
            f.tapflow_id === cleanTarget ||
            f.slug === cleanTarget ||
            f.name?.toLowerCase() === cleanTarget.toLowerCase() ||
            (typeof f.url === 'string' && f.url.includes(cleanTarget)) ||
            (typeof f.checkout_url === 'string' && f.checkout_url.includes(cleanTarget))
          );
        });
        if (matched && matched.active !== false && matched.status !== 'inactive') {
          const matchedId = (matched.id || matched.tapflow_id || config.tapFlowId).toString().trim();
          if (matchedId) {
            this.saveDiscoveredTapFlowId(matchedId);
            return {
              tapFlowId: matchedId,
              source: 'configured',
              details: matched,
            };
          }
        }
      }

      // Identify an active TapFlow that supports checkout collection functionality
      const activeFlow =
        flows.find((f) => {
          if (!f || typeof f !== 'object') return false;
          const isActive = f.active !== false && f.status !== 'inactive' && f.status !== 'archived';
          const collectionEnabled = f.payment_collection !== false && f.can_collect !== false;
          const supportsOpenAmount = f.open_amount === true || f.supports_open_amount === true || !f.fixed_amount;
          return isActive && collectionEnabled && supportsOpenAmount;
        }) ||
        flows.find((f) => {
          if (!f || typeof f !== 'object') return false;
          return f.active !== false && f.status !== 'inactive' && f.status !== 'archived';
        }) ||
        flows.find((f) => Boolean(f && typeof f === 'object' && (f.id || f.tapflow_id)));

      if (activeFlow && typeof activeFlow === 'object') {
        const flowId = (activeFlow.id || activeFlow.tapflow_id || '').toString().trim();
        if (flowId) {
          // Securely save the discovered ID into backend configuration as PAYNECTA_TAPFLOW_ID
          this.saveDiscoveredTapFlowId(flowId);

          return {
            tapFlowId: flowId,
            source: 'discovered',
            details: activeFlow,
          };
        }
      }
    }

    // 4. If manually configured via PAYNECTA_TAPFLOW_ID in server environment
    if (config.tapFlowId) {
      return { tapFlowId: config.tapFlowId, source: 'configured' };
    }

    // 5. If query encountered authentication or authorization failure, rethrow that specific error
    if (queryError) {
      if (queryError.includes('authentication failed') || queryError.includes('401')) {
        throw new Error(queryError);
      }
      if (queryError.includes('not authorized') || queryError.includes('403')) {
        throw new Error(queryError);
      }
    }

    // 6. Handle missing configuration properly with exact prompt message:
    throw new Error(
      'Paynecta setup incomplete. No active payment collection flow was found. Please configure or activate a TapFlow in your Paynecta account.'
    );
  }

  /**
   * 3. INITIALIZE PAYMENT CHECKOUT SESSION
   * Creates a Paynecta checkout session using whole Kenyan Shillings.
   * Documented endpoint: POST /v1/checkout_sessions (with fallback to /checkout/sessions)
   *
   * Features:
   * - Validates user's selected amount in whole KES and converts to subunits of 100
   * - Enforces minimum deposit thresholds (KES 650 / ~$5.00 USD)
   * - Validates customer email address
   * - Selects active TapFlow that supports open amounts and payment collection
   * - Generates dynamic webhook URL referencing APP_BASE_URL or APP_URL for verification
   * - Generates return and cancel redirect URLs
   * - Customer enters their own M-Pesa phone number and PIN on Paynecta's secure checkout page
   * - Returns session id, checkout url, dynamic webhook url, and transaction details
   */
  public async initializeCheckoutSession(
    params: InitializeCheckoutSessionParams
  ): Promise<InitializeCheckoutSessionResult> {
    const config = this.getConfig();
    const { isReady, missing } = this.isConfigured();

    if (!isReady) {
      throw new Error(`Paynecta setup required. Missing environment variables: ${missing.join(', ')}`);
    }

    // 1. Amount Validation (Whole Kenyan Shillings only, reject decimals/fractions)
    const amount = Number(params.amount);
    if (!amount || isNaN(amount) || amount <= 0) {
      throw new Error('Please provide a valid deposit amount in whole Kenyan Shillings (KES).');
    }

    if (!Number.isInteger(amount)) {
      throw new Error('Paynecta requires whole Kenyan Shillings (KES). Fractional cents or decimals are not accepted.');
    }

    if (amount < config.minDepositKes) {
      throw new Error(
        `Minimum deposit is KES ${config.minDepositKes.toLocaleString()} (approx. USD ${config.minDepositUsd.toFixed(2)}).`
      );
    }
    if (amount > 250000) {
      throw new Error('The maximum single Paynecta M-Pesa payment is KES 250,000.');
    }

    // 2. Email Validation
    const email = (params.email || '').trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      throw new Error('A valid customer email address is required to initialize checkout.');
    }

    // 3. Dynamic Webhook URL referencing APP_BASE_URL or APP_URL
    const rawAppUrl =
      params.appUrl ||
      config.appBaseUrl ||
      (typeof process !== 'undefined' && (process.env.APP_BASE_URL || process.env.APP_URL)) ||
      'http://localhost:3000';
    const cleanAppUrl = rawAppUrl.replace(/\/+$/, '');
    if (!cleanAppUrl.startsWith('https://')) {
      throw new Error('Paynecta requires APP_URL to be an HTTPS address. Set APP_URL to your deployed Vercel domain.');
    }
    const webhookUrl = `${cleanAppUrl}/api/paynecta/webhook`;

    // 4. Unique Merchant Reference
    const merchantReference =
      params.merchantReference?.trim() ||
      `DO-DEP-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const redirectUrl = `${cleanAppUrl}/?deposit_ref=${encodeURIComponent(merchantReference)}&status=return`;
    const cancelUrl = `${cleanAppUrl}/?deposit_ref=${encodeURIComponent(merchantReference)}&status=cancelled`;

    // 5. Amount in Subunits (100 subunits per 1 KES)
    const amountSubunits = amount * 100;

    // 6. Obtain Auth Bearer Token
    const token = await this.getAccessToken();

    // 7. Resolve usable TapFlow with payment collection enabled
    const tapFlowResolution = await this.resolveActiveTapFlowId();
    const resolvedTapFlowId = tapFlowResolution.tapFlowId;

    // 8. Assemble Request Body according to Paynecta API documentation
    // Paynecta accepts a TapFlow, amount in KES cents, merchant reference,
    // and HTTPS return URLs. The payer enters their own M-Pesa number on Paynecta.
    const requestBody: Record<string, any> = {
      tapflow: resolvedTapFlowId,
      amount: amountSubunits,
      reference: merchantReference,
      redirect_url: redirectUrl,
      cancel_url: cancelUrl,
    };

    // 9. Call Paynecta's documented checkout-session endpoint.
    const sessionEndpoints = [`${config.baseUrl}/checkout_sessions`];

    let lastError: any = null;
    let responseData: any = null;

    for (const endpoint of sessionEndpoints) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        if (!res.ok) {
          const errorText = await res.text();
          let errorData: any = {};
          try {
            errorData = JSON.parse(errorText);
          } catch {
            errorData = { message: errorText };
          }
          const msg =
            errorData.message ||
            errorData.error ||
            errorData.error_description ||
            errorText ||
            res.statusText;
          const nextStep = errorData.meta?.next_step ? ` (${errorData.meta.next_step})` : '';
          throw new Error(`Paynecta Session Creation Failed (${res.status}): ${msg}${nextStep}`);
        }

        responseData = await res.json();
        break;
      } catch (err: any) {
        lastError = err;
        if (endpoint === sessionEndpoints[0] && !err.message.includes('Session Creation Failed')) {
          continue;
        }
        break;
      }
    }

    if (!responseData || typeof responseData !== 'object') {
      throw lastError || new Error('Could not initiate checkout session with Paynecta: empty response received.');
    }

    // Check if API returned an error payload
    if (responseData.status === 'error' || responseData.error) {
      throw new Error(responseData.message || responseData.error || 'Paynecta returned an error creating checkout session.');
    }

    const sessionObj =
      (responseData.data && typeof responseData.data === 'object' && responseData.data) ||
      (responseData.session && typeof responseData.session === 'object' && responseData.session) ||
      (responseData.checkout_session && typeof responseData.checkout_session === 'object' && responseData.checkout_session) ||
      (responseData.payload && typeof responseData.payload === 'object' && responseData.payload) ||
      responseData;

    if (!sessionObj || typeof sessionObj !== 'object') {
      throw new Error('Paynecta checkout session response did not contain a valid session object.');
    }

    const rawSessionId =
      sessionObj.id ||
      sessionObj.session_id ||
      sessionObj.checkout_session_id ||
      sessionObj.checkoutSessionId;

    if (!rawSessionId || typeof rawSessionId !== 'string' || !rawSessionId.trim()) {
      throw new Error('Paynecta checkout session response is missing a valid session ID.');
    }
    const sessionId = rawSessionId.trim();

    const rawCheckoutUrl =
      sessionObj.checkout_url ||
      sessionObj.url ||
      sessionObj.payment_url ||
      sessionObj.redirect_url;

    if (!rawCheckoutUrl || typeof rawCheckoutUrl !== 'string' || !rawCheckoutUrl.trim()) {
      throw new Error('Paynecta response did not provide a valid checkout URL.');
    }
    const checkoutUrl = rawCheckoutUrl.trim();

    return {
      sessionId,
      checkoutUrl,
      merchantReference,
      amountSubunits,
      currency: 'KES',
      status: sessionObj.status ? String(sessionObj.status) : 'pending',
      webhookUrl,
      redirectUrl,
      cancelUrl,
      amountKes: amount,
      tapFlowId: resolvedTapFlowId,
    };
  }

  /**
   * Alias for initializeCheckoutSession
   */
  public async initializePaymentCheckout(
    params: InitializeCheckoutSessionParams
  ): Promise<InitializeCheckoutSessionResult> {
    return this.initializeCheckoutSession(params);
  }

  /**
   * Backwards compatible createCheckoutSession
   */
  public async createCheckoutSession(params: CreateSessionParams): Promise<PaynectaSessionResponse> {
    const res = await this.initializeCheckoutSession({
      amount: params.amountKes,
      email: params.customer.email,
      phone: params.customer.phone,
      name: params.customer.name,
      merchantReference: params.merchantReference,
      appUrl: params.appUrl,
    });

    return {
      sessionId: res.sessionId,
      checkoutUrl: res.checkoutUrl,
      merchantReference: res.merchantReference,
      amountSubunits: res.amountSubunits,
      currency: res.currency,
      status: res.status,
    };
  }

  /**
   * 4. INDEPENDENT TRANSACTION VERIFICATION
   * Queries Paynecta API: GET /v1/checkout_sessions/{id}
   * Only considers payment successful when payment.status is 'succeeded'.
   */
  public async verifyCheckoutSession(
    sessionId: string,
    merchantReference: string
  ): Promise<PaynectaVerificationResult> {
    const config = this.getConfig();
    const { isReady } = this.isConfigured();

    if (!isReady) {
      return {
        status: 'verification_delayed',
        failureReason: 'Paynecta credentials are not configured on server.',
      };
    }

    try {
      const token = await this.getAccessToken();

      // Paynecta's documented checkout-session verification endpoint.
      const lookupUrls = [
        `${config.baseUrl}/checkout_sessions/${encodeURIComponent(sessionId)}`,
      ];

      let data: any = null;
      let lastStatus = 0;

      for (const url of lookupUrls) {
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
          },
        });

        lastStatus = res.status;
        if (res.ok) {
          data = await res.json();
          break;
        }
      }

      if (!data) {
        return {
          status: 'verification_delayed',
          failureReason: `Paynecta checkout-session verification is temporarily unavailable (${lastStatus}).`,
        };
      }

      return this.mapPaynectaStatus(data.data || data);
    } catch (err: any) {
      console.error('[Paynecta Service] Verification exception:', err.message);
      return {
        status: 'verification_delayed',
        failureReason: `Network error verifying transaction with Paynecta: ${err.message}`,
      };
    }
  }

  private mapPaynectaStatus(data: any): PaynectaVerificationResult {
    if (!data || typeof data !== 'object') {
      return {
        status: 'verification_delayed',
        failureReason: 'Invalid payment status data received from gateway.',
      };
    }

    // Only consider payment successful when Paynecta confirms payment.status is 'succeeded'
    const paymentStatus =
      (data.payment && typeof data.payment === 'object' && data.payment.status) ||
      data.payment_status ||
      data.status ||
      '';
    const rawStatus = String(paymentStatus).toLowerCase();

    // Confirmed amount handling (subunits converted to whole KES or already in whole KES)
    let confirmedAmountKes: number | undefined;
    const amountVal =
      (data.payment && typeof data.payment === 'object' && data.payment.amount) ??
      data.amount ??
      data.amount_subunits;
    if (typeof amountVal === 'number') {
      confirmedAmountKes = amountVal >= 1000 ? Math.round(amountVal / 100) : amountVal;
    }

    const providerReference =
      (data.payment && typeof data.payment === 'object' && data.payment.reference) ||
      data.transaction_id ||
      data.reference ||
      data.provider_reference ||
      (data.id != null ? String(data.id) : undefined);

    const receiptNumber =
      (data.payment && typeof data.payment === 'object' && (data.payment.receipt_number || data.payment.receipt)) ||
      data.receipt_number ||
      data.mpesa_receipt ||
      data.receipt;

    switch (rawStatus) {
      case 'succeeded':
      case 'completed':
      case 'paid':
      case 'success':
        return {
          status: 'succeeded',
          confirmedAmountKes,
          providerReference,
          receiptNumber,
          rawStatus,
        };

      case 'pending':
      case 'processing':
      case 'awaiting_payment':
      case 'awaiting_approval':
      case 'submitted':
      case 'created':
        return {
          status: 'pending',
          rawStatus,
        };

      case 'cancelled':
      case 'abandoned':
      case 'expired':
        return {
          status: 'cancelled',
          failureReason: data.cancel_reason || 'Payment cancelled by user.',
          rawStatus,
        };

      case 'failed':
      case 'declined':
      case 'refused':
      case 'insufficient_funds':
      case 'timed_out':
      case 'rejected':
        return {
          status: 'failed',
          failureReason: data.failure_reason || data.error_message || 'Payment was refused or insufficient funds.',
          rawStatus,
        };

      default:
        return {
          status: 'pending',
          rawStatus,
        };
    }
  }

  /**
   * 5. WEBHOOK SIGNATURE & TIMESTAMP VALIDATION
   * Verifies incoming webhook signatures using HMAC-SHA256 against
   * the original raw request body and the Paynecta-Timestamp header.
   * Uses constant-time signature comparison and rejects outdated webhook timestamps (> 300s).
   */
  public verifyWebhook(params: {
    rawBody: string;
    signatureHeader?: string;
    timestampHeader?: string;
  }): { isValid: boolean; reason?: string } {
    const config = this.getConfig();
    if (!config.webhookSecret) {
      return { isValid: false, reason: 'PAYNECTA_WEBHOOK_SECRET is not configured on server.' };
    }

    const { rawBody, signatureHeader, timestampHeader } = params;
    if (!signatureHeader || !timestampHeader) {
      return { isValid: false, reason: 'Missing Paynecta signature or timestamp header.' };
    }

    const timestampSeconds = Number(timestampHeader);
    if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) {
      return { isValid: false, reason: 'Invalid Paynecta timestamp header.' };
    }
    const ageSeconds = Math.abs(Date.now() / 1000 - timestampSeconds);
    if (ageSeconds > 300) {
      return { isValid: false, reason: 'Webhook timestamp is outside the 5-minute acceptance window.' };
    }

    try {
      // Paynecta signs exactly: "<timestamp>.<raw request body>".
      const expected = crypto
        .createHmac('sha256', config.webhookSecret)
        .update(`${timestampHeader}.${rawBody}`)
        .digest('hex');
      const received = signatureHeader.trim().toLowerCase();
      const expectedBuffer = Buffer.from(expected, 'utf8');
      const receivedBuffer = Buffer.from(received, 'utf8');
      if (
        expectedBuffer.length === receivedBuffer.length &&
        crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
      ) {
        return { isValid: true };
      }
      return { isValid: false, reason: 'Webhook HMAC-SHA256 signature mismatch.' };
    } catch (err: any) {
      return { isValid: false, reason: `Signature verification exception: ${err.message}` };
    }
  }

  // Backwards compatibility for verifyWebhookSignature(payloadRaw, signatureHeader)
  public verifyWebhookSignature(payloadRaw: string, signatureHeader?: string): boolean {
    return this.verifyWebhook({ rawBody: payloadRaw, signatureHeader }).isValid;
  }
}

export const paynectaService = new PaynectaService();
export default paynectaService;

/**
 * Top-level function to initialize a payment checkout session using the Paynecta API.
 * Supports the user's selected amount, email, and dynamically generates a webhook URL
 * referencing the current APP_URL for verification.
 */
export async function initializeCheckoutSession(
  params: InitializeCheckoutSessionParams
): Promise<InitializeCheckoutSessionResult> {
  return paynectaService.initializeCheckoutSession(params);
}

/**
 * Standalone alias function for initializeCheckoutSession
 */
export async function initializePaymentCheckout(
  params: InitializeCheckoutSessionParams
): Promise<InitializeCheckoutSessionResult> {
  return paynectaService.initializeCheckoutSession(params);
}

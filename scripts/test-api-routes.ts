import http from 'node:http';
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import app from '../backend';
import { localFallbackStore } from '../server/localFallbackStore';
import { adminRiskStore, isProtectedAdminUser } from '../server/adminRiskStore';

async function runTests() {
  console.log('--- Starting API Route & Auth Verification Tests ---');

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind server');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  console.log(`Test server running at ${baseUrl}`);

  let createdTestUserId: string | null = null;

  try {
    // Test 1: GET /api/health returns HTTP 200 and JSON with "DevOptions Backend"
    console.log('\n[Test 1] Testing GET /api/health...');
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.strictEqual(healthRes.status, 200, `Expected 200 but got ${healthRes.status}`);
    const healthContentType = healthRes.headers.get('content-type') || '';
    assert.ok(healthContentType.includes('application/json'), `Expected JSON content-type but got ${healthContentType}`);
    const healthData = await healthRes.json();
    assert.strictEqual(healthData.status, 'ok', `Expected status ok but got ${healthData.status}`);
    assert.strictEqual(healthData.service, 'DevOptions Backend', `Expected service 'DevOptions Backend' but got ${healthData.service}`);
    console.log('✓ GET /api/health verified:', healthData);

    // Test 2: GET /api route alias
    console.log('\n[Test 2] Testing GET /api alias...');
    const apiAliasRes = await fetch(`${baseUrl}/api`);
    assert.strictEqual(apiAliasRes.status, 200);
    const apiAliasData = await apiAliasRes.json();
    assert.strictEqual(apiAliasData.service, 'DevOptions Backend');
    console.log('✓ GET /api alias verified:', apiAliasData);

    // Test 3: API requests never return React HTML page
    console.log('\n[Test 3] Testing unknown /api route returns JSON 404, never HTML...');
    const unknownRes = await fetch(`${baseUrl}/api/non-existent-route`);
    assert.strictEqual(unknownRes.status, 404, `Expected 404 but got ${unknownRes.status}`);
    const unknownContentType = unknownRes.headers.get('content-type') || '';
    assert.ok(unknownContentType.includes('application/json'), `Expected JSON content-type but got ${unknownContentType}`);
    const unknownData = await unknownRes.json();
    assert.ok(unknownData.error, 'Expected error message in JSON response');
    assert.ok(!JSON.stringify(unknownData).includes('<!DOCTYPE html>'), 'Response must not contain HTML');
    console.log('✓ Unknown /api route returned JSON 404 (not HTML):', unknownData);

    // Test 4: POST /api/auth/login reaches Express handler and validates empty body
    console.log('\n[Test 4] Testing POST /api/auth/login validation...');
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: '', password: '' }),
    });
    assert.strictEqual(loginRes.status, 400, `Expected 400 validation error but got ${loginRes.status}`);
    const loginContentType = loginRes.headers.get('content-type') || '';
    assert.ok(loginContentType.includes('application/json'), `Expected JSON content-type but got ${loginContentType}`);
    const loginData = await loginRes.json();
    assert.strictEqual(loginData.error, 'Email/Phone and password are required.');
    console.log('✓ POST /api/auth/login validation verified:', loginData);

    // Test 5: POST /api/auth/register reaches Express handler and validates invalid input
    console.log('\n[Test 5] Testing POST /api/auth/register validation...');
    const registerRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invalid-email', password: 'short' }),
    });
    assert.strictEqual(registerRes.status, 400, `Expected 400 validation error but got ${registerRes.status}`);
    const registerContentType = registerRes.headers.get('content-type') || '';
    assert.ok(registerContentType.includes('application/json'), `Expected JSON content-type but got ${registerContentType}`);
    const registerData = await registerRes.json();
    assert.ok(registerData.error, 'Expected error message from registration handler');
    console.log('✓ POST /api/auth/register validation verified:', registerData);

    // Test 6: OPTIONS preflight request preserves HTTP methods and CORS
    console.log('\n[Test 6] Testing OPTIONS preflight request...');
    const optionsRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://devoptions-preview.vercel.app',
        'Access-Control-Request-Method': 'POST',
      },
    });
    assert.strictEqual(optionsRes.status, 204, `Expected 204 No Content but got ${optionsRes.status}`);
    const allowMethods = optionsRes.headers.get('access-control-allow-methods') || '';
    assert.ok(allowMethods.includes('POST'), `Expected POST in allowed methods, got ${allowMethods}`);
    assert.ok(allowMethods.includes('GET'), `Expected GET in allowed methods, got ${allowMethods}`);
    console.log('✓ OPTIONS preflight request verified. Allowed methods:', allowMethods);

    // Test 7: Full Sign-up -> /api/auth/me -> Logout -> Login (email + local phone) flow
    console.log('\n[Test 7] Testing full sign-up, session verification, logout, and login...');
    const uniqueSuffix = Date.now().toString().slice(-7);
    const testEmail = `testtrader_${uniqueSuffix}@example.com`;
    const testLocalPhone = `071${uniqueSuffix}`;
    const testPassword = 'TestPassword2026!';

    const signupRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        phone: testLocalPhone,
        password: testPassword,
        confirmPassword: testPassword,
        fullName: 'Test Trader',
        country: 'Kenya',
      }),
    });
    const signupJson = await signupRes.json();
    assert.strictEqual(
      signupRes.status,
      201,
      `Expected 201 Created but got ${signupRes.status}: ${JSON.stringify(signupJson)}`
    );
    assert.ok(signupJson.token, 'Expected session token from registration');
    assert.ok(signupJson.user?.id, 'Expected user id from registration');
    assert.strictEqual(signupJson.user.phone, `+25471${uniqueSuffix}`, 'Expected Kenyan phone normalization to E.164');
    assert.strictEqual(signupJson.user.role, 'user', 'Expected newly registered account role to be user');
    createdTestUserId = signupJson.user.id;
    console.log('✓ Sign-up succeeded:', signupJson.user.email, signupJson.user.phone);

    // Verify /api/auth/me works with Bearer token
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${signupJson.token}` },
    });
    assert.strictEqual(meRes.status, 200, `Expected 200 from /api/auth/me but got ${meRes.status}`);
    const meJson = await meRes.json();
    assert.strictEqual(meJson.user?.id, createdTestUserId);

    // Standard users must be blocked from admin endpoints
    const adminRes = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${signupJson.token}` },
    });
    assert.strictEqual(adminRes.status, 403, `Expected 403 for non-admin on /api/admin/overview but got ${adminRes.status}`);

    // Logout
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${signupJson.token}` },
    });
    assert.strictEqual(logoutRes.status, 200);

    // Login by email
    const emailLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: testEmail, password: testPassword }),
    });
    assert.strictEqual(emailLoginRes.status, 200, `Expected 200 from email login but got ${emailLoginRes.status}`);
    const emailLoginJson = await emailLoginRes.json();
    assert.ok(emailLoginJson.token, 'Expected session token on email login');

    // Login by local Kenyan phone format
    const phoneLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: testLocalPhone, password: testPassword }),
    });
    assert.strictEqual(phoneLoginRes.status, 200, `Expected 200 from phone login but got ${phoneLoginRes.status}`);
    const phoneLoginJson = await phoneLoginRes.json();
    assert.ok(phoneLoginJson.token, 'Expected session token on phone login');
    console.log('✓ Full sign-up -> /me -> RBAC check -> logout -> email & phone login verified!');

    // Test 8: Proxy cookies, repeated sign-in, session survival if sessions table cleared, and logout revocation
    console.log('\n[Test 8] Testing proxy headers, HTTPS iframe cookies, session survival, and logout revocation...');
    for (let i = 0; i < 18; i++) {
      const r = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.10',
          'X-Forwarded-Proto': 'https',
        },
        body: JSON.stringify({ identifier: testEmail, password: testPassword }),
      });
      assert.strictEqual(r.status, 200, `Expected 200 on repeated valid sign-in #${i + 1}, got ${r.status}`);
      if (i === 0) {
        const setCookie = r.headers.get('set-cookie') || '';
        assert.ok(setCookie.includes('SameSite=None'), `Expected SameSite=None on HTTPS proxy, got: ${setCookie}`);
        assert.ok(setCookie.includes('Secure'), `Expected Secure on HTTPS proxy, got: ${setCookie}`);
      }
    }

    // Simulate local session store wipe across container restart while keeping signed token
    localFallbackStore.deleteSessionsByUser(createdTestUserId!);
    const survivedMeRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${phoneLoginJson.token}` },
    });
    assert.strictEqual(survivedMeRes.status, 200, `Expected signed session to survive session-table wipe, got ${survivedMeRes.status}`);

    // Explicit logout must permanently revoke that signed token
    const revokeLogoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${phoneLoginJson.token}`,
        'X-Forwarded-Proto': 'https',
      },
    });
    assert.strictEqual(revokeLogoutRes.status, 200);
    const clearCookie = revokeLogoutRes.headers.get('set-cookie') || '';
    assert.ok(clearCookie.includes('Max-Age=0') && clearCookie.includes('SameSite=None'), `Expected matching clear cookie, got: ${clearCookie}`);

    const afterLogoutMeRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${phoneLoginJson.token}` },
    });
    assert.strictEqual(afterLogoutMeRes.status, 401, 'Logged-out token must be rejected even if signed');

    // Signing in again right after logout must always succeed
    const reloginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: testEmail, password: testPassword }),
    });
    assert.strictEqual(reloginRes.status, 200, 'Expected re-login after logout to succeed');
    const reloginJson = await reloginRes.json();
    assert.ok(reloginJson.token && reloginJson.expiresAt, 'Expected token and expiresAt from login');
    console.log('✓ Proxy cookies, repeated sign-in, restart survival, revocation, and re-login verified!');

    // Test 9: POST /api/auth/refresh and sliding refresh on GET /api/auth/me
    console.log('\n[Test 9] Testing /api/auth/refresh and sliding /api/auth/me...');
    const freshMeRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${reloginJson.token}` },
    });
    assert.strictEqual(freshMeRes.status, 200);
    const freshMeJson = await freshMeRes.json();
    assert.strictEqual(freshMeJson.refreshed, false, 'Fresh session should not immediately rotate on /me');
    assert.ok(typeof freshMeJson.expiresAt === 'number', 'Expected expiresAt from /api/auth/me');

    const refreshRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${reloginJson.token}` },
    });
    assert.strictEqual(refreshRes.status, 200, `Expected 200 from /api/auth/refresh, got ${refreshRes.status}`);
    const refreshJson = await refreshRes.json();
    assert.ok(refreshJson.token, 'Expected rotated token from /api/auth/refresh');
    assert.notStrictEqual(refreshJson.token, reloginJson.token, 'Refreshed token must be a newly issued token');
    assert.ok(refreshJson.expiresAt >= reloginJson.expiresAt, 'Refreshed expiresAt must extend session lifetime');

    // Simulate near-expiry session (< 3.5 days remaining) to verify sliding refresh on /api/auth/me
    const nearExpirySession = localFallbackStore.findSession(refreshJson.token);
    assert.ok(nearExpirySession, 'Expected refreshed session in localFallbackStore');
    nearExpirySession!.expires_at = Date.now() + 24 * 60 * 60 * 1000; // 1 day remaining
    const slidingMeRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${refreshJson.token}` },
    });
    assert.strictEqual(slidingMeRes.status, 200);
    const slidingMeJson = await slidingMeRes.json();
    assert.strictEqual(slidingMeJson.refreshed, true, 'Near-expiry session must auto-rotate on /api/auth/me');
    assert.ok(slidingMeJson.token && slidingMeJson.token !== refreshJson.token, 'Expected rotated token on sliding /me');

    // Verify invalid token refresh returns 401
    const invalidRefreshRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { Authorization: 'Bearer invalid.token.value' },
    });
    assert.strictEqual(invalidRefreshRes.status, 401);
    console.log('✓ /api/auth/refresh and sliding /api/auth/me verified!');

    // Test 10: AuthClient session persistence, dual-storage healing, refresh, and state-change logging
    console.log('\n[Test 10] Testing AuthClient persistence, refresh, deduplication, and logging...');
    const createMemoryStorage = (): Storage => {
      const store = new Map<string, string>();
      return {
        get length() {
          return store.size;
        },
        clear() {
          store.clear();
        },
        getItem(k: string) {
          return store.has(k) ? store.get(k)! : null;
        },
        key(index: number) {
          return Array.from(store.keys())[index] ?? null;
        },
        removeItem(k: string) {
          store.delete(k);
        },
        setItem(k: string, v: string) {
          store.set(k, String(v));
        },
      };
    };

    const origWindow = (globalThis as any).window;
    const origFetch = globalThis.fetch;
    const mockLocal = createMemoryStorage();
    const mockSession = createMemoryStorage();
    const storageListeners = new Set<(ev: any) => void>();
    let simulatedFetchOverride: ((url: string, init?: RequestInit) => Promise<Response> | null) | null = null;

    (globalThis as any).window = {
      localStorage: mockLocal,
      sessionStorage: mockSession,
      addEventListener(type: string, cb: any) {
        if (type === 'storage') storageListeners.add(cb);
      },
      removeEventListener(type: string, cb: any) {
        if (type === 'storage') storageListeners.delete(cb);
      },
    };
    globalThis.fetch = ((input: any, init?: RequestInit) => {
      const rawUrl = typeof input === 'string' ? input : input?.url || String(input);
      if (simulatedFetchOverride) {
        const overridden = simulatedFetchOverride(rawUrl, init);
        if (overridden) return overridden;
      }
      const resolvedUrl = rawUrl.startsWith('/') ? `${baseUrl}${rawUrl}` : rawUrl;
      return origFetch(resolvedUrl, init);
    }) as typeof fetch;

    const { AuthClient } = await import('../src/services/authClient');
    let clientA: InstanceType<typeof AuthClient> | null = null;
    let clientB: InstanceType<typeof AuthClient> | null = null;
    let clientC: InstanceType<typeof AuthClient> | null = null;

    try {
      clientA = new AuthClient();
      const observedStates: Array<string | null> = [];
      clientA.subscribe((u) => {
        observedStates.push(u ? u.id : null);
      });

      await clientA.login({ identifier: testEmail, password: testPassword });
      assert.ok(clientA.isAuthenticated(), 'ClientA must be authenticated after login');
      const tokenAfterLogin = clientA.getToken();
      assert.ok(tokenAfterLogin, 'Expected token after login');
      assert.strictEqual(mockLocal.getItem('devoptions_auth_token'), tokenAfterLogin, 'Token must persist in localStorage');
      assert.strictEqual(mockSession.getItem('devoptions_auth_token'), tokenAfterLogin, 'Token must persist in sessionStorage');
      assert.ok(mockLocal.getItem('devoptions_auth_expires_at'), 'Expiry timestamp must persist');

      // Simulate localStorage cleared externally while sessionStorage backup survives (navigation / browser privacy cleanup)
      mockLocal.removeItem('devoptions_auth_token');
      mockLocal.removeItem('devoptions_auth_user');
      mockLocal.removeItem('devoptions_auth_expires_at');

      // Re-instantiate AuthClient (simulating full page reload / navigation)
      clientB = new AuthClient();
      assert.ok(clientB.isAuthenticated(), 'Session must heal from sessionStorage across reload');
      assert.strictEqual(clientB.getToken(), tokenAfterLogin, 'Healed token must match login token');
      assert.strictEqual(mockLocal.getItem('devoptions_auth_token'), tokenAfterLogin, 'localStorage must be healed from sessionStorage');

      // Concurrent fetchMe calls must deduplicate cleanly and NOT emit spurious re-renders when user is unchanged
      let notifyCountBeforeFetchMe = 0;
      clientB.subscribe(() => {
        notifyCountBeforeFetchMe += 1;
      });
      const [me1, me2] = await Promise.all([clientB.fetchMe(), clientB.fetchMe()]);
      assert.strictEqual(me1?.id, createdTestUserId);
      assert.strictEqual(me2?.id, createdTestUserId);
      assert.strictEqual(notifyCountBeforeFetchMe, 0, 'Routine fetchMe sync with unchanged user must not trigger unnecessary subscriber re-renders');

      // Transient HTTP 500 error during fetchMe / refresh must preserve session
      simulatedFetchOverride = (url: string) => {
        if (url === '/api/auth/me') {
          return Promise.resolve(
            new Response(JSON.stringify({ error: 'Temporary gateway error' }), {
              status: 502,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }
        return null;
      };
      const transientMe = await clientB.fetchMe();
      assert.ok(transientMe && clientB.isAuthenticated(), 'Transient 502 must preserve session');
      simulatedFetchOverride = null;

      // Simulate 4 days passing so the 7-day token enters its < 3.5d proactive refresh window
      const origDateNow = Date.now;
      Date.now = () => origDateNow() + 4 * 24 * 60 * 60 * 1000;
      let tokenAfterProactiveRefresh: string | null = null;
      try {
        clientC = new AuthClient();
        const tokenBeforeProactiveRefresh = clientC.getToken();
        await clientC.getTrades();
        tokenAfterProactiveRefresh = clientC.getToken();
        assert.ok(
          tokenAfterProactiveRefresh && tokenAfterProactiveRefresh !== tokenBeforeProactiveRefresh,
          'Near-expiry session must proactively refresh token before authorized API request'
        );
        assert.strictEqual(
          mockLocal.getItem('devoptions_auth_token'),
          tokenAfterProactiveRefresh,
          'Proactively refreshed token must be persisted to localStorage'
        );
      } finally {
        Date.now = origDateNow;
      }

      // Simulate unexpected 401 on an authorized API call triggering automatic refresh + retry
      let forced401Once = false;
      simulatedFetchOverride = (url: string) => {
        if (url === '/api/user/trades' && !forced401Once) {
          forced401Once = true;
          return Promise.resolve(
            new Response(JSON.stringify({ error: 'Token rotated' }), {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }
        return null;
      };
      const retriedTrades = await clientC!.getTrades();
      simulatedFetchOverride = null;
      assert.ok(Array.isArray(retriedTrades), '401 retry after refresh must seamlessly complete getTrades()');
      assert.ok(clientC!.isAuthenticated(), 'Session must remain authenticated after successful 401 refresh-retry');

      // Verify cross-tab StorageEvent sign-out propagates cleanly to clientB
      assert.ok(clientB.isAuthenticated(), 'ClientB should still be authenticated before cross-tab sign-out');
      mockLocal.removeItem('devoptions_auth_token');
      storageListeners.forEach((cb) =>
        cb({
          key: 'devoptions_auth_token',
          newValue: null,
          storageArea: mockLocal,
        })
      );
      assert.strictEqual(clientB.isAuthenticated(), false, 'Cross-tab sign-out StorageEvent must sign out clientB');

      // Re-restore mockLocal from clientC? No, clientC shares mockLocal, so verify logs on clientC first,
      // then re-login clientC cleanly to verify explicit logout API + clearing.
      await clientC!.login({ identifier: testEmail, password: testPassword });

      // Verify comprehensive auth state change logs (with masked tokens)
      const logs = clientC!.getAuthLogs();
      const eventNames = logs.map((l) => l.event);
      assert.ok(eventNames.includes('INIT_RESTORED'), 'Expected INIT_RESTORED log entry');
      assert.ok(eventNames.includes('TOKEN_REFRESH_START'), 'Expected TOKEN_REFRESH_START log entry');
      assert.ok(eventNames.includes('TOKEN_REFRESH_SUCCESS'), 'Expected TOKEN_REFRESH_SUCCESS log entry');
      assert.ok(eventNames.includes('UNAUTHORIZED_RETRY_REFRESH'), 'Expected UNAUTHORIZED_RETRY_REFRESH log entry');
      assert.ok(eventNames.includes('AUTH_STATE_CHANGED'), 'Expected AUTH_STATE_CHANGED log entry');
      assert.ok(
        clientB.getAuthLogs().some((l) => l.event === 'STORAGE_SYNC'),
        'Expected STORAGE_SYNC log entry on cross-tab StorageEvent'
      );
      assert.ok(
        !JSON.stringify(logs).includes(tokenAfterProactiveRefresh!),
        'Full raw session token must never appear unmasked in auth logs'
      );

      // Logout clears both storages cleanly and logs transition
      await clientC!.logout();
      assert.strictEqual(clientC!.isAuthenticated(), false, 'Client must be unauthenticated after logout');
      assert.strictEqual(mockLocal.getItem('devoptions_auth_token'), null);
      assert.strictEqual(mockSession.getItem('devoptions_auth_token'), null);
      const afterLogoutEvents = clientC!.getAuthLogs().map((l) => l.event);
      assert.ok(afterLogoutEvents.includes('LOGOUT_COMPLETE'), 'Expected LOGOUT_COMPLETE log entry');
      assert.ok(afterLogoutEvents.includes('SESSION_CLEARED'), 'Expected SESSION_CLEARED log entry');
      console.log('✓ AuthClient persistence, healing, proactive/401 refresh, deduplication, and logging verified!');
    } finally {
      clientA?.dispose();
      clientB?.dispose();
      clientC?.dispose();
      globalThis.fetch = origFetch;
      (globalThis as any).window = origWindow;
    }

    // Test 11: Exclusive Protected Admin Loss Protection (3 Consecutive, 5 Total, Max Loss, Concurrency, Demo & Real, Persistence, Non-Admin Isolation)
    console.log('\n[Test 11] Testing exclusive francisgraham admin risk protection rules...');
    assert.strictEqual(
      isProtectedAdminUser({ role: 'admin', email: 'francisgraham071@gmail.com' }),
      true,
      'francisgraham071@gmail.com admin must be protected'
    );
    assert.strictEqual(
      isProtectedAdminUser({ role: 'user', email: 'francisgraham071@gmail.com' }),
      false,
      'Non-admin user must not be treated as protected admin'
    );

    const adminSuffix = Date.now().toString().slice(-6);
    const ephemeralAdminId = `adm_risk_${adminSuffix}`;
    const ephemeralAdminEmail = `francisgraham_test_${adminSuffix}@example.com`;
    const ephemeralAdminPass = 'RiskTestPass2026!';
    const ephemeralSalt = crypto.randomBytes(16).toString('hex');
    const ephemeralHash = `scrypt:${ephemeralSalt}:${crypto.scryptSync(ephemeralAdminPass, ephemeralSalt, 64).toString('hex')}`;

    localFallbackStore.insertUser({
      id: ephemeralAdminId,
      email: ephemeralAdminEmail,
      phone: `+254799${adminSuffix}`,
      password_hash: ephemeralHash,
      role: 'admin',
      email_verified: true,
      phone_verified: true,
      demo_balance: 10000,
      real_balance: 500,
      full_name: 'Francis Graham Test',
      country: 'Kenya',
      sound_enabled: true,
      theme: 'dark',
      created_at: Date.now(),
    });

    try {
      const admLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: ephemeralAdminEmail, password: ephemeralAdminPass }),
      });
      assert.strictEqual(admLoginRes.status, 200, 'Expected ephemeral protected admin login to succeed');
      const admToken = (await admLoginRes.json()).token as string;
      const admHeaders = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${admToken}`,
      };

      const makeTrade = (id: string, mode: 'demo' | 'real', stake: number) => ({
        id,
        symbol: 'R_100',
        contractType: 'CALL',
        stake,
        payoutRate: 0.95,
        potentialPayout: Number((stake * 1.95).toFixed(2)),
        entryTime: Date.now(),
        entryPrice: 1000.25,
        status: 'active',
        profitLoss: 0,
        mode,
        durationTicks: 1,
        remainingTicks: 1,
        ticksRecorded: [1000.25],
      });

      const settleTradeReq = async (tradeId: string, status: 'won' | 'lost', stake: number) => {
        const profitLoss = status === 'won' ? Number((stake * 0.95).toFixed(2)) : -stake;
        const r = await fetch(`${baseUrl}/api/user/trades/${encodeURIComponent(tradeId)}/settle`, {
          method: 'POST',
          headers: admHeaders,
          body: JSON.stringify({
            status,
            stake,
            profitLoss,
            exitPrice: status === 'won' ? 1001.1 : 999.4,
            exitTime: Date.now(),
            ticksRecorded: [1000.25, status === 'won' ? 1001.1 : 999.4],
          }),
        });
        assert.strictEqual(r.status, 200, `Expected 200 settling ${tradeId}, got ${r.status}`);
        return r.json();
      };

      // 11A: Start bot session with Max Loss = $20 -> 3 consecutive losses ($2 each) halts trading until manual restart
      const start1 = await fetch(`${baseUrl}/api/user/risk-protection/start`, {
        method: 'POST',
        headers: admHeaders,
        body: JSON.stringify({ maxLoss: 20, mode: 'demo' }),
      });
      assert.strictEqual(start1.status, 200);

      for (let i = 1; i <= 3; i++) {
        const tid = `adm_c_${adminSuffix}_${i}`;
        const p = await fetch(`${baseUrl}/api/user/trades/place`, {
          method: 'POST',
          headers: admHeaders,
          body: JSON.stringify({ trade: makeTrade(tid, 'demo', 2), mode: 'demo' }),
        });
        assert.strictEqual(p.status, 201, `Trade ${i} of 3 should be allowed`);
        const s = await settleTradeReq(tid, 'lost', 2);
        if (i < 3) {
          assert.strictEqual(s.riskState.halted, false);
        } else {
          assert.strictEqual(s.riskState.consecutiveLosses, 3);
          assert.strictEqual(s.riskState.totalLosses, 3);
          assert.strictEqual(s.riskState.halted, true);
          assert.strictEqual(s.riskState.haltCode, 'MAX_CONSECUTIVE_LOSSES');
        }
      }

      // 4th trade blocked in BOTH demo and real modes while halted
      const blocked4Demo = await fetch(`${baseUrl}/api/user/trades/place`, {
        method: 'POST',
        headers: admHeaders,
        body: JSON.stringify({ trade: makeTrade(`adm_c4d_${adminSuffix}`, 'demo', 2), mode: 'demo' }),
      });
      assert.strictEqual(blocked4Demo.status, 403, '4th trade after 3 consecutive losses must be blocked in demo');

      const blocked4Real = await fetch(`${baseUrl}/api/user/trades/place`, {
        method: 'POST',
        headers: admHeaders,
        body: JSON.stringify({ trade: makeTrade(`adm_c4r_${adminSuffix}`, 'real', 2), mode: 'real' }),
      });
      assert.strictEqual(blocked4Real.status, 403, '4th trade after 3 consecutive losses must be blocked in real mode too');

      // Reload from disk (simulate server restart/refresh) -> lock & counters must persist
      adminRiskStore.reloadFromDiskForTests();
      const afterReloadRes = await fetch(`${baseUrl}/api/user/risk-protection`, { headers: admHeaders });
      const afterReloadJson = await afterReloadRes.json();
      assert.strictEqual(afterReloadJson.riskState.halted, true, 'Halt must survive server restart');
      assert.strictEqual(afterReloadJson.riskState.consecutiveLosses, 3);
      assert.strictEqual(afterReloadJson.riskState.totalLosses, 3);

      // 11B: Manual restart clears consecutiveLosses to 0, preserves totalLosses=3 & cumulativeLoss=$6, cannot inflate maxLoss
      const restart1 = await fetch(`${baseUrl}/api/user/risk-protection/start`, {
        method: 'POST',
        headers: admHeaders,
        body: JSON.stringify({ maxLoss: 500, mode: 'demo' }), // Attempt to inflate maxLoss must be capped to 20
      });
      assert.strictEqual(restart1.status, 200);
      const restart1Json = await restart1.json();
      assert.strictEqual(restart1Json.riskState.consecutiveLosses, 0, 'Manual restart resets consecutive losses');
      assert.strictEqual(restart1Json.riskState.totalLosses, 3, 'Manual restart must preserve totalLosses in period');
      assert.strictEqual(restart1Json.riskState.configuredMaxLoss, 20, 'Mid-period maxLoss must not inflate above $20');

      // Lose #4 ($2), then WIN ($2 -> +$1.90) resets consecutiveLosses to 0 while keeping totalLosses=4
      const tid4 = `adm_t4_${adminSuffix}`;
      assert.strictEqual(
        (await fetch(`${baseUrl}/api/user/trades/place`, {
          method: 'POST',
          headers: admHeaders,
          body: JSON.stringify({ trade: makeTrade(tid4, 'demo', 2), mode: 'demo' }),
        })).status,
        201
      );
      await settleTradeReq(tid4, 'lost', 2);

      const tidWin = `adm_win_${adminSuffix}`;
      assert.strictEqual(
        (await fetch(`${baseUrl}/api/user/trades/place`, {
          method: 'POST',
          headers: admHeaders,
          body: JSON.stringify({ trade: makeTrade(tidWin, 'demo', 2), mode: 'demo' }),
        })).status,
        201
      );
      const winSettled = await settleTradeReq(tidWin, 'won', 2);
      assert.strictEqual(winSettled.riskState.consecutiveLosses, 0, 'Winning trade must reset consecutiveLosses');
      assert.strictEqual(winSettled.riskState.totalLosses, 4, 'Winning trade must preserve totalLosses=4');

      // Concurrent flood test when 4 total losses already recorded: only 1 trade can reserve, 2nd concurrent trade MUST be rejected
      const concA = makeTrade(`adm_concA_${adminSuffix}`, 'demo', 2);
      const concB = makeTrade(`adm_concB_${adminSuffix}`, 'demo', 2);
      const [concResA, concResB] = await Promise.all([
        fetch(`${baseUrl}/api/user/trades/place`, {
          method: 'POST',
          headers: admHeaders,
          body: JSON.stringify({ trade: concA, mode: 'demo' }),
        }),
        fetch(`${baseUrl}/api/user/trades/place`, {
          method: 'POST',
          headers: admHeaders,
          body: JSON.stringify({ trade: concB, mode: 'demo' }),
        }),
      ]);
      const statuses = [concResA.status, concResB.status].sort();
      assert.deepStrictEqual(statuses, [201, 409], 'Concurrent guard must permit 1 and reject 2nd to prevent >5 total losses');

      // Settle the accepted 5th losing trade -> triggers MAX_TOTAL_LOSSES lock!
      const acceptedConcId = concResA.status === 201 ? concA.id : concB.id;
      const settle5 = await settleTradeReq(acceptedConcId, 'lost', 2);
      assert.strictEqual(settle5.riskState.totalLosses, 5);
      assert.strictEqual(settle5.riskState.halted, true);
      assert.strictEqual(settle5.riskState.haltCode, 'MAX_TOTAL_LOSSES');

      // Attempting manual Start after 5 total losses MUST be blocked (403) across restarts
      adminRiskStore.reloadFromDiskForTests();
      const blockedRestart5 = await fetch(`${baseUrl}/api/user/risk-protection/start`, {
        method: 'POST',
        headers: admHeaders,
        body: JSON.stringify({ maxLoss: 20, mode: 'demo' }),
      });
      assert.strictEqual(blockedRestart5.status, 403, 'Manual start must be blocked after 5 total losses');

      // Ordinary user must get 403 calling reset-period
      const nonAdminReset = await fetch(`${baseUrl}/api/user/risk-protection/reset-period`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${reloginJson.token}`,
        },
        body: JSON.stringify({ confirmReset: true }),
      });
      assert.strictEqual(nonAdminReset.status, 403, 'Ordinary user must not reset admin risk period');

      // Authorized admin period reset clears MAX_TOTAL_LOSSES lock cleanly
      const authReset = await fetch(`${baseUrl}/api/user/risk-protection/reset-period`, {
        method: 'POST',
        headers: admHeaders,
        body: JSON.stringify({ confirmReset: true, maxLoss: 10 }),
      });
      assert.strictEqual(authReset.status, 200, 'Protected admin period reset must succeed');
      const authResetJson = await authReset.json();
      assert.strictEqual(authResetJson.riskState.totalLosses, 0);
      assert.strictEqual(authResetJson.riskState.consecutiveLosses, 0);
      assert.strictEqual(authResetJson.riskState.halted, false);
      assert.strictEqual(authResetJson.riskState.configuredMaxLoss, 10);

      // 11C: Hard Max Loss Protection ($10 max loss)
      await fetch(`${baseUrl}/api/user/risk-protection/start`, {
        method: 'POST',
        headers: admHeaders,
        body: JSON.stringify({ maxLoss: 10, mode: 'demo' }),
      });
      // Stake $11 exceeds $10 remaining allowance -> rejected (403)
      const overStakeRes = await fetch(`${baseUrl}/api/user/trades/place`, {
        method: 'POST',
        headers: admHeaders,
        body: JSON.stringify({ trade: makeTrade(`adm_over_${adminSuffix}`, 'demo', 11), mode: 'demo' }),
      });
      assert.strictEqual(overStakeRes.status, 403, 'Trade stake exceeding remaining loss allowance must be rejected');

      // Compliant $10 stake allowed, loses $10 -> hits cumulativeLoss = $10 -> MAX_LOSS_REACHED halt
      const maxTradeId = `adm_max_${adminSuffix}`;
      assert.strictEqual(
        (await fetch(`${baseUrl}/api/user/trades/place`, {
          method: 'POST',
          headers: admHeaders,
          body: JSON.stringify({ trade: makeTrade(maxTradeId, 'demo', 10), mode: 'demo' }),
        })).status,
        201
      );
      const settledMax = await settleTradeReq(maxTradeId, 'lost', 10);
      assert.strictEqual(settledMax.riskState.cumulativeLoss, 10);
      assert.strictEqual(settledMax.riskState.halted, true);
      assert.strictEqual(settledMax.riskState.haltCode, 'MAX_LOSS_REACHED');

      // Also verify direct Real-mode gate enforcement in adminRiskStore when halted and when unhalted
      const directRealBlocked = await adminRiskStore.withUserLock(ephemeralAdminId, () =>
        adminRiskStore.validateAndReserveTradeLocked(
          { id: ephemeralAdminId, email: ephemeralAdminEmail, role: 'admin' },
          { id: `adm_real_blk_${adminSuffix}`, stake: 2 },
          'real'
        )
      );
      assert.strictEqual(directRealBlocked.allowed, false, 'Real mode trade must be blocked when admin is halted');

      // Reset period and verify ordinary user is completely unaffected by admin risk limits (can lose 6 times in a row)
      const normalHeaders = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${reloginJson.token}`,
      };
      const normalRiskRes = await fetch(`${baseUrl}/api/user/risk-protection`, { headers: normalHeaders });
      const normalRiskJson = await normalRiskRes.json();
      assert.strictEqual(normalRiskJson.protected, false);
      assert.strictEqual(normalRiskJson.riskState, null);
      for (let i = 1; i <= 6; i++) {
        const uid = `usr_loss_${adminSuffix}_${i}`;
        const p = await fetch(`${baseUrl}/api/user/trades/place`, {
          method: 'POST',
          headers: normalHeaders,
          body: JSON.stringify({ trade: makeTrade(uid, 'demo', 2), mode: 'demo' }),
        });
        assert.strictEqual(p.status, 201, `Ordinary user trade #${i} must never be blocked by admin limits`);
        const s = await fetch(`${baseUrl}/api/user/trades/${encodeURIComponent(uid)}/settle`, {
          method: 'POST',
          headers: normalHeaders,
          body: JSON.stringify({
            status: 'lost',
            stake: 2,
            profitLoss: -2,
            exitPrice: 999.1,
            exitTime: Date.now(),
            ticksRecorded: [1000.25, 999.1],
          }),
        });
        assert.strictEqual(s.status, 200);
      }
      console.log('✓ Exclusive admin risk protection (3 consecutive, 5 total, max loss, concurrency, persistence, period reset, Demo/Real, non-admin isolation) verified!');
    } finally {
      localFallbackStore.deleteUser(ephemeralAdminId);
      const riskPath = path.resolve(process.cwd(), 'data', 'admin-risk.json');
      if (fs.existsSync(riskPath)) {
        try {
          const raw = JSON.parse(fs.readFileSync(riskPath, 'utf-8'));
          if (raw?.states?.[ephemeralAdminId]) {
            delete raw.states[ephemeralAdminId];
            fs.writeFileSync(riskPath, JSON.stringify(raw, null, 2));
          }
        } catch {
          // ignore cleanup failure
        }
      }
    }

    // Test 12: Verify no user-visible simulation wording remains across active frontend UI components
    console.log('\n[Test 12] Scanning frontend UI modules for forbidden simulation wording...');
    const uiFilesToCheck = [
      'src/App.tsx',
      'src/data/syntheticMarkets.ts',
      'src/components/trading/TradeWorkspace.tsx',
      'src/components/trading/SimpleBotPanel.tsx',
      'src/components/trading/DemoTrading.tsx',
      'src/components/trading/MarketSelectorBar.tsx',
      'src/components/modals/ProviderSettingsModal.tsx',
      'src/components/modals/DepositModal.tsx',
      'src/components/modals/ProfileModal.tsx',
      'src/components/account/AccountPage.tsx',
      'src/components/dashboard/Dashboard.tsx',
      'src/components/settings/SettingsPage.tsx',
      'src/components/backtesting/BacktestEngine.tsx',
      'src/components/backtesting/MonteCarloSimulation.tsx',
      'src/components/common/DisclaimerBanner.tsx',
      'src/components/help/RiskDisclosure.tsx',
      'src/components/history/TradeHistory.tsx',
      'src/components/layout/Sidebar.tsx',
    ];
    for (const relPath of uiFilesToCheck) {
      const content = fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf-8');
      assert.ok(
        !/simulated|simulation account|virtual balance|virtual demo|practice demo/i.test(content),
        `Unexpected simulation/virtual/practice wording found in ${relPath}`
      );
    }
    console.log('✓ Zero forbidden simulation wording found in active UI modules!');

    console.log('\n========================================');
    console.log('All API, Auth, Risk Protection & UI tests PASSED!');
    console.log('========================================\n');
  } finally {
    if (createdTestUserId) {
      localFallbackStore.deleteUser(createdTestUserId);
    }
    server.close();
  }
}

runTests().catch((err) => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});

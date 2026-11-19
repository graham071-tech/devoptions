import http from 'node:http';
import assert from 'node:assert';
import app from '../backend';
import { localFallbackStore } from '../server/localFallbackStore';

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

    console.log('\n========================================');
    console.log('All API routing and Auth tests PASSED!');
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

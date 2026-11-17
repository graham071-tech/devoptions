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

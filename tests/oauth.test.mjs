import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { exportJWK } from 'jose';
import { authorize } from '../src/core/contracts.mjs';
import {
  authChallenge, createOAuthAuthenticator, hostedAuthConfig, protectedResourceMetadata
} from '../src/adapters/oauth.mjs';

// These in-memory keys are isolated test fixtures, never saved or provisioned.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
const env = {
  DOCUMENT_ORIGIN: 'https://document.example',
  DOCUMENT_OAUTH_ISSUER: 'https://identity.example/',
  DOCUMENT_OAUTH_JWKS_URL: 'https://identity.example/.well-known/jwks.json'
};
const config = hostedAuthConfig(env);
const authenticate = createOAuthAuthenticator(config, { keyResolver: async () => publicKey });
const now = () => Math.floor(Date.now() / 1000);
const claims = (overrides = {}) => ({
  iss: config.issuer, aud: config.resource, sub: 'auth0|alice', scope: 'document:read',
  iat: now(), exp: now() + 300, ...overrides
});
function jwt(payload = claims(), header = { alg: 'RS256', typ: 'at+jwt', kid: 'fixture' }, key = privateKey) {
  const body = [header, payload].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
  return `${body}.${sign('RSA-SHA256', Buffer.from(body), key).toString('base64url')}`;
}
const request = token => ({ headers: { authorization: `Bearer ${token}` } });
const rejected = error => error.status === 401 && error.code === 'INVALID_TOKEN' && error.oauthError === 'invalid_token';

test('hosted configuration pins HTTPS trust and the exact MCP resource audience', () => {
  assert.equal(config.origin, env.DOCUMENT_ORIGIN);
  assert.equal(config.issuer, env.DOCUMENT_OAUTH_ISSUER);
  assert.equal(config.jwksUrl, env.DOCUMENT_OAUTH_JWKS_URL);
  assert.equal(config.resource, `${config.origin}/mcp`);
  assert.equal(config.audience, config.resource);
  assert.equal(config.maxTokenAge, 3600);
  assert.ok(Object.isFrozen(config));
  assert.ok(Object.isFrozen(config.scopes));
  assert.deepEqual(hostedAuthConfig({ ...env, DOCUMENT_OAUTH_AUDIENCE: config.resource }), config);
});

for (const [label, overrides] of [
  ['missing origin', { DOCUMENT_ORIGIN: undefined }],
  ['missing issuer', { DOCUMENT_OAUTH_ISSUER: undefined }],
  ['missing key source', { DOCUMENT_OAUTH_JWKS_URL: undefined }],
  ['HTTP origin', { DOCUMENT_ORIGIN: 'http://document.example' }],
  ['HTTP issuer', { DOCUMENT_OAUTH_ISSUER: 'http://identity.example' }],
  ['HTTP JWKS', { DOCUMENT_OAUTH_JWKS_URL: 'http://identity.example/jwks' }],
  ['origin path', { DOCUMENT_ORIGIN: 'https://document.example/app' }],
  ['origin trailing slash', { DOCUMENT_ORIGIN: 'https://document.example/' }],
  ['issuer credentials', { DOCUMENT_OAUTH_ISSUER: 'https://user:password@identity.example/' }],
  ['JWKS credentials', { DOCUMENT_OAUTH_JWKS_URL: 'https://user:password@identity.example/jwks' }],
  ['JWKS query', { DOCUMENT_OAUTH_JWKS_URL: 'https://identity.example/jwks?key=secret' }],
  ['issuer fragment', { DOCUMENT_OAUTH_ISSUER: 'https://identity.example/#fragment' }],
  ['empty issuer query', { DOCUMENT_OAUTH_ISSUER: 'https://identity.example/?' }],
  ['normalized issuer path', { DOCUMENT_OAUTH_ISSUER: 'https://identity.example/a/../issuer' }],
  ['malformed issuer scheme', { DOCUMENT_OAUTH_ISSUER: 'https:identity.example' }],
  ['malformed JWKS scheme', { DOCUMENT_OAUTH_JWKS_URL: 'https:///identity.example/jwks' }],
  ['header injection', { DOCUMENT_ORIGIN: 'https://document.example\r\nX-Injected: yes' }],
  ['URL normalization ambiguity', { DOCUMENT_ORIGIN: 'https://DOCUMENT.example' }],
  ['wrong explicit audience', { DOCUMENT_OAUTH_AUDIENCE: 'document' }],
  ['audience trailing slash', { DOCUMENT_OAUTH_AUDIENCE: `${config.resource}/` }],
  ['empty explicit audience', { DOCUMENT_OAUTH_AUDIENCE: '' }]
]) test(`hosted configuration rejects ${label}`, () => {
  assert.throws(() => hostedAuthConfig({ ...env, ...overrides }), error => error.status === 500 && error.code === 'AUTH_CONFIG');
});

test('local reference flags and request-derived origins cannot disable hosted verification', () => {
  assert.throws(() => hostedAuthConfig({ DOCUMENT_AUTH: 'local', NODE_ENV: 'development', HOST: '127.0.0.1', VERCEL_URL: 'document.example' }), { code: 'AUTH_CONFIG' });
  assert.throws(() => createOAuthAuthenticator({ ...config, resource: 'https://evil.example/mcp' }), { code: 'AUTH_CONFIG' });
  assert.throws(() => createOAuthAuthenticator({ ...config, metadataUrl: 'https://evil.example/metadata' }), { code: 'AUTH_CONFIG' });
  assert.throws(() => createOAuthAuthenticator(config, { keyResolver: publicKey }), { code: 'AUTH_CONFIG' });
});

test('metadata and challenges advertise the pinned resource without trusting error text', () => {
  assert.deepEqual(protectedResourceMetadata(config), {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: ['document:read', 'document:write', 'document:publish'],
    bearer_methods_supported: ['header']
  });
  const challenge = authChallenge(config);
  assert.match(challenge, /^Bearer resource_metadata="https:\/\/document\.example\/\.well-known\/oauth-protected-resource"/);
  assert.ok(challenge.includes('scope="document:read document:write document:publish"'));
  assert.ok(challenge.includes('error="invalid_token"'));
  assert.ok(challenge.includes('error_description="Sign in to use Document."'));
  assert.equal(authChallenge(config, '\r\nX-Injected: token-secret'), challenge);
  assert.ok(authChallenge(config, 'INSUFFICIENT_SCOPE').includes('error="insufficient_scope"'));
  assert.equal(authChallenge(config, 'insufficient_scope'), authChallenge(config, 'INSUFFICIENT_SCOPE'));
});

test('RS256 produces an isolated personal actor from the signed issuer and subject', async () => {
  const actor = await authenticate(request(jwt()));
  const hash = createHash('sha256').update(JSON.stringify([config.issuer, 'auth0|alice'])).digest('hex');
  assert.deepEqual(actor, { sub: 'auth0|alice', tenant: `personal_${hash}`, role: 'viewer', scopes: ['document:read'] });
  assert.match(actor.tenant, /^personal_[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(actor));
  assert.ok(Object.isFrozen(actor.scopes));
  authorize(actor, 'read');
  assert.throws(() => authorize(actor, 'write'), { status: 403 });
});

for (const [scope, expectedRole] of [
  ['document:read', 'viewer'],
  ['document:read document:write', 'editor'],
  ['document:read document:write document:publish', 'publisher'],
  ['document:publish document:read document:write', 'publisher'],
  ['document:read document:publish', 'viewer'],
  ['document:read document:admin unknown:write', 'viewer']
]) test(`scopes ${scope} yield only ${expectedRole} capability`, async () => {
  const actor = await authenticate(request(jwt(claims({ scope, role: 'admin', document_role: 'admin' }))));
  assert.equal(actor.role, expectedRole);
  assert.ok(!actor.scopes.includes('document:admin'));
  if (expectedRole === 'publisher') authorize(actor, 'publish');
  else assert.throws(() => authorize(actor, 'publish'), { status: 403 });
});

test('role and tenant claims cannot elevate authority or switch to another person’s documents', async () => {
  const alice = await authenticate(request(jwt(claims({ scope: 'document:read document:write' }))));
  const elevated = await authenticate(request(jwt(claims({ document_role: 'admin', role: 'publisher', workspace_id: alice.tenant, tenant: alice.tenant, scopes: ['document:publish'] }))));
  assert.equal(elevated.tenant, alice.tenant);
  assert.equal(elevated.role, 'viewer');
  const bob = await authenticate(request(jwt(claims({ sub: 'auth0|bob', workspace_id: alice.tenant, tenant: alice.tenant }))));
  assert.notEqual(bob.tenant, alice.tenant);
  const otherConfig = hostedAuthConfig({ ...env, DOCUMENT_OAUTH_ISSUER: 'https://other-identity.example/' });
  const otherAuth = createOAuthAuthenticator(otherConfig, { keyResolver: async () => publicKey });
  const otherIssuerAlice = await otherAuth(request(jwt(claims({ iss: otherConfig.issuer }))));
  assert.notEqual(otherIssuerAlice.tenant, alice.tenant);
  assert.equal(Object.hasOwn(bob, 'workspace_id'), false);
});

test('personal identity hashing frames issuer and subject to prevent concatenation collisions', async () => {
  const tenants = [];
  for (const [issuer, sub] of [['https://identity.example/a', 'bc'], ['https://identity.example/ab', 'c']]) {
    const scopedConfig = hostedAuthConfig({ ...env, DOCUMENT_OAUTH_ISSUER: issuer });
    const auth = createOAuthAuthenticator(scopedConfig, { keyResolver: async () => publicKey });
    tenants.push((await auth(request(jwt(claims({ iss: issuer, sub }))))).tenant);
  }
  assert.notEqual(tenants[0], tenants[1]);
});

for (const [label, override] of [
  ['expired token', () => ({ exp: now() - 1 })],
  ['missing expiry', () => ({ exp: undefined })],
  ['fractional expiry', () => ({ exp: now() + 200.5 })],
  ['string expiry', () => ({ exp: String(now() + 200) })],
  ['missing issuance', () => ({ iat: undefined })],
  ['fractional issuance', () => ({ iat: now() - 0.5 })],
  ['future issuance', () => ({ iat: now() + 90 })],
  ['future activation', () => ({ nbf: now() + 90 })],
  ['fractional activation', () => ({ nbf: now() - 0.5 })],
  ['negative activation', () => ({ nbf: -1 })],
  ['overlong lifetime', () => ({ exp: now() + 3601 })],
  ['zero lifetime', () => ({ iat: now() + 100, exp: now() + 100 })],
  ['stale issuance with extended expiry', () => ({ iat: now() - 3601, exp: now() + 100 })],
  ['wrong issuer', () => ({ iss: 'https://attacker.example/' })],
  ['issuer normalization', () => ({ iss: 'https://identity.example' })],
  ['wrong audience', () => ({ aud: 'another-resource' })],
  ['audience array', () => ({ aud: [config.resource] })],
  ['multiple audiences', () => ({ aud: [config.resource, 'another-resource'] })],
  ['resource claim replacing audience', () => ({ aud: undefined, resource: config.resource })],
  ['audience trailing slash', () => ({ aud: `${config.resource}/` })],
  ['missing subject', () => ({ sub: undefined })],
  ['empty subject', () => ({ sub: '' })],
  ['non-string subject', () => ({ sub: { id: 'alice' } })],
  ['space in subject', () => ({ sub: 'alice bob' })],
  ['subject control character', () => ({ sub: 'alice\u0000bob' })],
  ['subject trailing newline', () => ({ sub: 'alice\n' })],
  ['oversized subject', () => ({ sub: 'a'.repeat(257) })],
  ['missing scope', () => ({ scope: undefined })],
  ['array scope', () => ({ scope: ['document:read'] })],
  ['scope alternate claim', () => ({ scope: undefined, scp: ['document:read'] })],
  ['scope with newline', () => ({ scope: 'document:read\n' })],
  ['scope with tab', () => ({ scope: 'document:read\tdocument:write' })],
  ['oversized scope', () => ({ scope: `document:read ${'a'.repeat(2048)}` })]
]) test(`OAuth rejects ${label}`, async () => {
  await assert.rejects(() => authenticate(request(jwt(claims(override())))), rejected);
});

test('one-hour token lifetime and valid activation are accepted', async () => {
  const timestamp = now();
  const actor = await authenticate(request(jwt(claims({ iat: timestamp, nbf: timestamp, exp: timestamp + 3600 }))));
  assert.equal(actor.role, 'viewer');
});

for (const scope of ['document:write', 'document:write document:publish', 'openid', 'document:reader', 'DOCUMENT:READ']) {
  test(`read scope is mandatory even with ${scope}`, async () => {
    await assert.rejects(() => authenticate(request(jwt(claims({ scope })))), error =>
      error.status === 403 && error.code === 'INSUFFICIENT_SCOPE' && error.oauthError === 'insufficient_scope');
  });
}

test('no bearer token rejects cookies and URL query credentials', async () => {
  await assert.rejects(() => authenticate({ headers: { cookie: `token=${jwt()}` }, url: `/mcp?access_token=${jwt()}` }),
    error => error.status === 401 && error.code === 'AUTH_REQUIRED');
  await assert.rejects(() => authenticate({}), error => error.status === 401 && error.code === 'AUTH_REQUIRED');
});

test('authorization supports Node and Fetch request headers without case-sensitive bearer handling', async () => {
  const token = jwt();
  assert.equal((await authenticate({ headers: { Authorization: `bearer ${token}` } })).sub, 'auth0|alice');
  assert.equal((await authenticate(new Request(config.resource, { headers: { Authorization: `Bearer ${token}` } }))).sub, 'auth0|alice');
});

test('malformed and ambiguous authorization headers fail closed', async () => {
  const token = jwt();
  for (const value of [`Basic ${token}`, `Bearer  ${token}`, ` Bearer ${token}`, `Bearer ${token}\n`,
    `Bearer ${token}, Bearer ${token}`, ['Bearer ' + token], `Bearer ${'a'.repeat(12000)}`, 'Bearer a.b.c',
    'Bearer eyJhbGciOiJub25lIn0.e30.']) {
    await assert.rejects(() => authenticate({ headers: { authorization: value } }), rejected);
  }
  await assert.rejects(() => authenticate({ headers: { authorization: `Bearer ${token}`, Authorization: `Bearer ${token}` } }), rejected);
  await assert.rejects(() => authenticate({ ...request(token), rawHeaders: ['Authorization', `Bearer ${token}`, 'authorization', `Bearer ${token}`] }), rejected);
});

test('JWT algorithm allowlist rejects confusion before calling a key resolver', async () => {
  let resolutions = 0;
  const auth = createOAuthAuthenticator(config, { keyResolver: async () => { resolutions++; return publicKey; } });
  for (const alg of ['HS256', 'RS512', 'PS256', 'none']) {
    await assert.rejects(() => auth(request(jwt(claims(), { alg }))), rejected);
  }
  assert.equal(resolutions, 0);
});

test('signature tampering and a different signing key never authenticate', async () => {
  const token = jwt();
  await assert.rejects(() => authenticate(request(token.slice(0, -12) + '000000000000')), rejected);
  await assert.rejects(() => authenticate(request(jwt(claims(), { alg: 'RS256' }, otherKey.privateKey))), rejected);
});

test('undersized RSA verification keys are rejected', async () => {
  const weak = generateKeyPairSync('rsa', { modulusLength: 1024 });
  const auth = createOAuthAuthenticator(config, { keyResolver: async () => weak.publicKey });
  await assert.rejects(() => auth(request(jwt(claims(), { alg: 'RS256' }, weak.privateKey))), rejected);
});

test('JWT-supplied key URLs or embedded keys cannot replace configured trust', async () => {
  let resolutions = 0;
  const auth = createOAuthAuthenticator(config, { keyResolver: async () => { resolutions++; return publicKey; } });
  for (const extra of [{ jku: 'https://attacker.example/jwks' }, { x5u: 'https://attacker.example/cert' },
    { jwk: await exportJWK(otherKey.publicKey) }, { x5c: ['untrusted'] }, { crit: ['untrusted'] },
    { kid: 'fixture\n' }, { kid: 'a'.repeat(257) }]) {
    await assert.rejects(() => auth(request(jwt(claims(), { alg: 'RS256', ...extra }))), rejected);
  }
  assert.equal(resolutions, 0);
});

test('resolver failures are masked and never reveal upstream or token details', async () => {
  const auth = createOAuthAuthenticator(config, { keyResolver: async () => { throw new Error('provider URL?secret=do-not-echo'); } });
  await assert.rejects(() => auth(request(jwt())), error => rejected(error) && error.message === 'Invalid access token.' && !('cause' in error));
});

test('remote JWKS fetch pins the configured URL, does not forward credentials and caches public keys', async t => {
  const jwk = { ...await exportJWK(publicKey), alg: 'RS256', kid: 'fixture', use: 'sig' };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const auth = createOAuthAuthenticator(config);
  assert.equal((await auth(request(jwt()))).sub, 'auth0|alice');
  assert.equal((await auth(request(jwt(claims({ sub: 'auth0|bob' }))))).sub, 'auth0|bob');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, config.jwksUrl);
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.has('authorization'), false);
  assert.equal(calls[0].options.headers.has('cookie'), false);
});

test('JWKS redirects, unavailable providers and invalid keysets fail closed', async t => {
  for (const response of [
    () => new Response(null, { status: 302, headers: { location: 'http://attacker.example/jwks' } }),
    () => new Response('upstream sensitive failure', { status: 503 }),
    () => new Response('not-json', { status: 200 }),
    () => new Response(JSON.stringify({ keys: [] }), { status: 200 })
  ]) {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => response());
    await assert.rejects(() => createOAuthAuthenticator(config)(request(jwt())), rejected);
    assert.equal(fetchMock.mock.callCount(), 1);
    fetchMock.mock.restore();
  }
});

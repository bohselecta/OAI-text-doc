import { createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { Fault, fail } from '../core/contracts.mjs';

const SCOPES = Object.freeze(['document:read', 'document:write', 'document:publish']);
const MAX_TOKEN_AGE = 3600;
const MAX_AUTHORIZATION_LENGTH = 12000;

function httpsUrl(value, label, originOnly = false) {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\s"\\<>?#\u0000-\u001f\u007f]/u.test(value)) {
    fail(500, 'AUTH_CONFIG', `Configure ${label} as a trusted HTTPS URL.`);
  }
  let parsed;
  try { parsed = new URL(value); } catch { fail(500, 'AUTH_CONFIG', `Configure a valid ${label}.`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash ||
      (parsed.href !== value && parsed.origin !== value) ||
      (originOnly && parsed.origin !== value)) {
    fail(500, 'AUTH_CONFIG', `Configure ${label} as an exact HTTPS ${originOnly ? 'origin' : 'URL'} without credentials, query or fragment.`);
  }
  return value;
}

/** Hosted authentication never falls back to the loopback reference identity. */
export function hostedAuthConfig(env = process.env) {
  const origin = httpsUrl(env.DOCUMENT_ORIGIN, 'DOCUMENT_ORIGIN', true);
  const issuer = httpsUrl(env.DOCUMENT_OAUTH_ISSUER, 'DOCUMENT_OAUTH_ISSUER');
  const jwksUrl = httpsUrl(env.DOCUMENT_OAUTH_JWKS_URL, 'DOCUMENT_OAUTH_JWKS_URL');
  const resource = `${origin}/mcp`;
  const audience = env.DOCUMENT_OAUTH_AUDIENCE ?? resource;
  if (audience !== resource) fail(500, 'AUTH_CONFIG', 'DOCUMENT_OAUTH_AUDIENCE must exactly equal DOCUMENT_ORIGIN followed by /mcp.');
  return Object.freeze({
    origin, issuer, audience, jwksUrl, resource,
    metadataUrl: `${origin}/.well-known/oauth-protected-resource`,
    scopes: SCOPES,
    maxTokenAge: MAX_TOKEN_AGE
  });
}

function trustedConfig(config) {
  const resolved = hostedAuthConfig({
    DOCUMENT_ORIGIN: config?.origin,
    DOCUMENT_OAUTH_ISSUER: config?.issuer,
    DOCUMENT_OAUTH_JWKS_URL: config?.jwksUrl,
    DOCUMENT_OAUTH_AUDIENCE: config?.audience
  });
  if ((config.resource !== undefined && config.resource !== resolved.resource) ||
      (config.metadataUrl !== undefined && config.metadataUrl !== resolved.metadataUrl)) {
    fail(500, 'AUTH_CONFIG', 'OAuth resource and metadata URLs must match the configured origin.');
  }
  return resolved;
}

function rejectToken(code = 'INVALID_TOKEN', oauthError = 'invalid_token', status = 401) {
  const message = code === 'AUTH_REQUIRED' ? 'Sign in to use Document.' :
    oauthError === 'insufficient_scope' ? 'The document:read scope is required.' : 'Invalid access token.';
  const error = new Fault(status, code, message);
  error.oauthError = oauthError;
  throw error;
}

function bearerToken(req) {
  // Node exposes duplicate fields in rawHeaders even when headers.authorization was collapsed.
  if (Array.isArray(req?.rawHeaders)) {
    let count = 0;
    for (let index = 0; index < req.rawHeaders.length; index += 2) {
      if (String(req.rawHeaders[index]).toLowerCase() === 'authorization') count++;
    }
    if (count > 1) rejectToken();
  }
  const headers = req?.headers;
  let authorization;
  if (typeof headers?.get === 'function') authorization = headers.get('authorization');
  else if (headers && typeof headers === 'object') {
    const entries = Object.entries(headers).filter(([key]) => key.toLowerCase() === 'authorization');
    if (entries.length > 1) rejectToken();
    authorization = entries[0]?.[1];
  }
  if (authorization === undefined || authorization === null || authorization === '') rejectToken('AUTH_REQUIRED');
  if (typeof authorization !== 'string' || authorization.length > MAX_AUTHORIZATION_LENGTH) rejectToken();
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(authorization);
  if (!match || match[0] !== authorization) rejectToken();
  return match[1];
}

/**
 * Verify a resource-specific bearer token on every request. keyResolver is a trusted
 * host/test dependency, never selected by a request or an environment bypass flag.
 * JWKS keys come only from the configured URL; jose does not follow its redirects.
 */
export function createOAuthAuthenticator(config, { keyResolver } = {}) {
  const trusted = trustedConfig(config);
  if (keyResolver !== undefined && typeof keyResolver !== 'function') {
    fail(500, 'AUTH_CONFIG', 'The trusted key resolver must be a function.');
  }
  const resolveKey = keyResolver ?? createRemoteJWKSet(new URL(trusted.jwksUrl), {
    timeoutDuration: 5000,
    cooldownDuration: 30000,
    cacheMaxAge: 600000
  });
  return async req => {
    const token = bearerToken(req);
    let claims;
    try {
      const verified = await jwtVerify(token, async (header, input) => {
        // Never trust alternate key locations carried in an attacker-controlled JWT.
        if (['jku', 'jwk', 'x5u', 'x5c', 'crit'].some(name => Object.hasOwn(header, name)) ||
            (header.kid !== undefined && (typeof header.kid !== 'string' || !header.kid ||
              header.kid.length > 256 || /[\s\u0000-\u001f\u007f]/u.test(header.kid)))) rejectToken();
        return resolveKey(header, input);
      }, {
        algorithms: ['RS256'],
        issuer: trusted.issuer,
        audience: trusted.audience,
        requiredClaims: ['iss', 'aud', 'sub', 'iat', 'exp', 'scope'],
        maxTokenAge: MAX_TOKEN_AGE,
        clockTolerance: 0
      });
      claims = verified.payload;
    } catch {
      // JWKS outages, unknown keys and cryptographic errors all deny access without
      // reflecting tokens, claims, upstream details or key material in the response.
      rejectToken();
    }
    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== trusted.issuer || claims.aud !== trusted.audience ||
        !Number.isSafeInteger(claims.iat) || claims.iat < 0 || claims.iat > now ||
        !Number.isSafeInteger(claims.exp) || claims.exp <= now || claims.exp <= claims.iat ||
        claims.exp - claims.iat > MAX_TOKEN_AGE ||
        (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf < 0 || claims.nbf > now || claims.nbf >= claims.exp)) ||
        typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 256 || /[^-A-Za-z0-9._~:@|/]/.test(claims.sub)) rejectToken();

    // OAuth scope is the only authorization claim. Custom roles, tenants, workspace
    // IDs and alternative "scp" claims cannot expand access to this resource.
    if (typeof claims.scope !== 'string' || claims.scope.length > 2048 || /[\r\n]/.test(claims.scope) ||
        !/^[\x21\x23-\x5B\x5D-\x7E]+(?: [\x21\x23-\x5B\x5D-\x7E]+)*$/.test(claims.scope)) rejectToken();
    const granted = new Set(claims.scope.split(' '));
    if (!granted.has('document:read')) rejectToken('INSUFFICIENT_SCOPE', 'insufficient_scope', 403);
    const scopes = Object.freeze(SCOPES.filter(scope => granted.has(scope)));
    const role = granted.has('document:write') ? (granted.has('document:publish') ? 'publisher' : 'editor') : 'viewer';
    // JSON framing avoids concatenation collisions. This is a non-secret namespace,
    // not an authentication credential; no shared/cross-user workspaces are enabled.
    const tenant = `personal_${createHash('sha256').update(JSON.stringify([trusted.issuer, claims.sub])).digest('hex')}`;
    return Object.freeze({ sub: claims.sub, tenant, role, scopes });
  };
}

/** RFC 9728 metadata for GET /.well-known/oauth-protected-resource. */
export function protectedResourceMetadata(config) {
  const trusted = trustedConfig(config);
  return {
    resource: trusted.resource,
    authorization_servers: [trusted.issuer],
    scopes_supported: [...trusted.scopes],
    bearer_methods_supported: ['header']
  };
}

/** Safe for both WWW-Authenticate and tool-result _meta["mcp/www_authenticate"]. */
export function authChallenge(config, errorCode = 'invalid_token') {
  const trusted = trustedConfig(config);
  const insufficient = errorCode === 'insufficient_scope' || errorCode === 'INSUFFICIENT_SCOPE';
  const error = insufficient ? 'insufficient_scope' : 'invalid_token';
  const description = insufficient ? 'Authorize the required Document scopes.' : 'Sign in to use Document.';
  return `Bearer resource_metadata="${trusted.metadataUrl}", scope="${trusted.scopes.join(' ')}", error="${error}", error_description="${description}"`;
}

# Run Document through Apps SDK, Vercel and Neon

This is a separate host adapter around the **exact existing `<language-document>`**. It is a working implementation boundary, not a claim of native OpenAI adoption. All original `src/ui`, `src/core` and `src/server` files are pinned byte-for-byte to main commit `22466c2` in [the native contract](native-module-contract.json). Existing local `npm run dev` remains unchanged and uses SQLite. Original exclusive license and branding remain unchanged.

## Architecture

ChatGPT/MCP Apps host → OAuth-authenticated `/mcp` → closed typed tools → async Document API adapter → transactional Neon PostgreSQL.

The widget loads the original module/CSS/icon without bundling or rewriting them. A per-instance API method adapter sends only recognized actions through the standard MCP Apps `tools/call` bridge. No global fetch interception, credentials in the iframe, new editor, or parallel product model. The exact reference shell remains within the app so New, Import and document switching remain available. Host file downloads use `ui/download-file` because sandboxed apps cannot rely on direct downloads.

`open_document` is read-only and never auto-seeds source. Source, actor details, proposals and BUILD files remain in widget-only MCP `_meta`; model-visible content contains minimal status, count and document ID. Two app-only tools provide closed read/action unions. App-only visibility is a host presentation hint, not security: every operation is authenticated, scope-authorized and tenant-bound on the server. Source is still untrusted data.

A context fence detects account/role changes; the widget clears/remounts old state and does not automatically replay mutations. Interrupted writes require refresh to discover whether they committed. Proposal acceptance and audited publication remain idempotent; creation and model requests are intentionally not blindly retried.

## Local credential-free rehearsal

Requires Node 22.16+ (Node 24 recommended), npm and optionally Python/Playwright for browser tests.

```sh
npm ci
npm run dev:apps
# Open http://127.0.0.1:4174
```

This local host uses actual MCP HTTP, the official MCP Apps bridge, and embedded PostgreSQL (PGlite) in `data/apps-pg`. It explicitly uses one fixed development identity and a deterministic rehearsal provider. It is **not OAuth, remote Neon, ChatGPT or a live model test**. It binds only loopback and refuses `NODE_ENV=production`. The harness is excluded from production static output. Stop with Ctrl-C. `DOCUMENT_DEV_DATA` optionally selects an isolated local data directory; `PORT` selects a loopback port.

Original native-adoption reference:

```sh
npm run dev
# http://127.0.0.1:4173
```

## Production prerequisites and authorization boundary

No infrastructure, database credentials, OAuth grants, Vercel deployment or live model usage is created by these scripts. An authorized operator must choose an existing or approved Neon database, Vercel project and established OAuth 2.1 identity provider. Do not paste credentials in chat, source, build logs or browser controls. Configure them through the services' approved secret/identity setup.

1. Configure a stable HTTPS deployment origin in `DOCUMENT_ORIGIN`.
2. Configure Neon `DATABASE_URL` with TLS. Use the pooled connection URL. This app uses `@neondatabase/serverless` with request-scoped WebSocket pools; pools close in `finally`. It never writes SQLite or app data to Vercel's filesystem.
3. Configure `DOCUMENT_OAUTH_ISSUER` and `DOCUMENT_OAUTH_JWKS_URL` for your trusted provider. `DOCUMENT_OAUTH_AUDIENCE` defaults to the exact `${DOCUMENT_ORIGIN}/mcp`; other audiences are rejected.
4. The provider must support authorization code + PKCE and ChatGPT client registration using current CIMD or DCR requirements. Its issuer discovery and authorization/token endpoints remain the provider's responsibility. This repository is an OAuth resource server, not an authorization server.
5. Issue RS256 access tokens with `iss`, scalar `aud`, stable `sub`, integer `iat` and `exp` no more than one hour apart, and a space-delimited `scope`. `document:read` is required; `document:write` enables authoring; all three including `document:publish` enable publication. Tokens granting only read remain viewers. Arbitrary role/workspace claims never grant access.
6. Every issuer+subject gets an isolated personal workspace. This slice intentionally has no cross-account/shared workspace memberships. Changing issuer or subject changes the namespace; plan identity migrations explicitly.
7. Keep `DOCUMENT_PROVIDER=rehearsal` for initial smoke tests. Enabling `openai` requires separately authorized server-side `OPENAI_API_KEY`, explicit `OPENAI_MODEL` and optionally `OPENAI_REVIEW_MODEL`. Model reviews incur two calls and remain fallible. A ChatGPT subscription is not assumed to cover API usage.

The MCP resource publishes `/.well-known/oauth-protected-resource` as an actual static JSON file. All MCP requests require valid resource tokens. Missing/invalid tokens get a standards-based `WWW-Authenticate` challenge. No local-auth fallback exists in production, and request IDs/headers cannot choose identities or JWKS endpoints.

## Explicit migration, build and deployment

On the approved target database, with credentials already securely configured:

```sh
npm run db:migrate
npm test
npm run build:hosted
```

Migration is explicit, idempotent and refuses unknown newer schema versions. It never runs at build time or on a web request. It creates prefixed `lc_*` tables without deleting/importing existing SQLite data. There is no automatic migration of pre-existing local documents: keep the local database/history backup, and use existing source export/import only when intended (source import does not preserve old history).

`vercel.json` builds `dist/public` and maps `/mcp` and `/healthz` to `api/index.mjs`. Framework preset: Other; project root: repository root; Node 24; serverless function duration: 150 seconds. Static CORS applies only to `/ui/*` and `/apps/*`; authenticated data never gets wildcard CORS. The reserved `/.well-known` path is served as a generated static file, never rewritten. Public OAuth origin/issuer/JWKS settings must be available at Vercel build time; missing config fails its build. Local builds without OAuth config are explicitly assets-only/non-deployable. Configure the exact origin per preview/production environment. Do not weaken deployment protection globally just to connect ChatGPT; use an authorized stable endpoint reachable by that host. `/healthz` is liveness only, not proof of database/provider readiness.

After deployment authorization, connect `${DOCUMENT_ORIGIN}/mcp` through the current ChatGPT developer/plugin flow, authorize required scopes and invoke `open_document`. Verify the actual live host handshake, CSP/static asset loading, downloads, OAuth reauthorization and account switching. If the host lacks the standard file-download capability, the widget reports this and preserves saved source; it cannot promise host-specific downloads.

## Persistence and operational boundaries

PostgreSQL document row locks serialize revision checks, current source, snapshots, event-chain writes, proposal acceptance and release publication in one transaction. Tenant locks bound document count and concurrent leases. JSON text preserves the original source-hash byte scope. SQL parameters carry source data; caller IDs never become table names.

Durable rate limits allow 30 POST operations per actor/minute, and inference leases allow one operation per actor and eight per tenant. Leases expire after 180 seconds; default provider requests time out after 45 seconds each and dual review uses at most two sequential calls. Expiry is crash recovery, not proof that external billing was cancelled. There is no automatic provider retry. Operational firewall/abuse controls and per-project spending budgets are still required before public launch.

History is append-only in application logic with a hash chain. A database administrator can still rewrite it; external anchoring, retention, backups and privileged access policy remain operator duties. Store all snapshots/audits/releases; no silent pruning. Publishing is a private immutable audited artifact, not publication to the web. Old draft exports are allowed and carry their historical source hash.

Rollback: revert the application deployment while retaining the additive schema and database. Never point the original SQLite server at PostgreSQL or discard history. Take provider-supported backups/branches before approved migrations. Schema version 1 is not a reversible deletion migration.

## Verification

```sh
npm test                         # native tests, adapters, auth and embedded PostgreSQL
npm run build:hosted
npm run test:browser              # original native module, real Chromium
npm run test:apps-browser         # sandboxed Apps host, real HTTP + embedded PostgreSQL
# Explicit disposable PostgreSQL test DB only; creates/drops its own random schema:
DOCUMENT_TEST_DATABASE_URL=... npm run test:neon
```

Fixtures use ephemeral signing keys and mocked model/JWKS replies. PostgreSQL 18.4 was exercised locally over loopback with concurrent connections; CI also exercises PostgreSQL 17. Neither is remote Neon. See [hosted acceptance evidence](HOSTED-STATUS.md) for exact current outcomes and outstanding live gates.

## Official references checked 2026-10-01

- [OpenAI MCP server](https://developers.openai.com/plugins/build/mcp-server)
- [OpenAI MCP Apps UI/bridge](https://developers.openai.com/plugins/build/chatgpt-ui) (Apps SDK URL redirects here)
- [OpenAI OAuth authentication](https://developers.openai.com/plugins/build/auth)
- [MCP Apps specification/SDK](https://github.com/modelcontextprotocol/ext-apps)
- [Vercel MCP deployment](https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel)
- [Vercel Node.js functions](https://vercel.com/docs/functions/runtimes/node-js)
- [Neon serverless driver](https://github.com/neondatabase/serverless) and [configuration/transactions](https://github.com/neondatabase/serverless/blob/main/CONFIG.md)

The public integration does not imply access to OpenAI's native product internals, adoption, endorsement or a signed legal grant.

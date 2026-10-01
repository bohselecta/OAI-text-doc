# Apps SDK + Vercel/Neon vertical slice

Baseline: `22466c2df904486dd6e67cfc97550fd1a61b6bb8`, main on 2026-10-01. No open pull requests existed when work began. This contract adds a deployable host adapter; it does not change the frozen native Document product contract.

| ID | Frozen promise | Acceptance |
|---|---|---|
| SDK-01 | Every original `src` file and existing exclusive grant stays byte-identical. The exact `<language-document>` remains independently native-adoptable. | SHA-256 regression manifest and unchanged existing tests |
| SDK-02 | Actual MCP Streamable HTTP and MCP Apps widget mount the exact component. Scoped user actions use an instance-local API bridge, with no provider or OAuth token in the iframe. | SDK client/resource/tool tests and browser journey |
| SDK-03 | Production uses verified OAuth JWT issuer, audience, expiration and scopes; personal issuer/subject tenancy prevents another account reading or modifying documents. | Auth, cross-user, account-switch and malformed input tests |
| SDK-04 | Neon PostgreSQL persists documents, snapshots, proposals, history, audits and releases. Transactional locks enforce concurrent revision checks and atomic commits. | Embedded PostgreSQL tests; real remote Neon explicitly separate |
| SDK-05 | Draft/Publish, scope, proposal acceptance, undo, lock, audit and BUILD receipt semantics match existing module. Rehearsal cannot claim model-reviewed release. | Hosted service parity and end-to-end tests |
| SDK-06 | Vercel functions do not persist state on local disk; process instances do not own durable user rate/operation locks. | Serverless entrypoint checks + database coordination tests |
| SDK-07 | Local reference workflow still runs. Setup, explicit migration, OAuth/resource metadata and environment example are provided. | Existing checks plus hosted build |
| SDK-08 | Provider calls, new services/credentials, deployment, merging and native product adoption are not implied by implementation. | Honest evidence matrix and draft PR only |

Scope: a personal Document workspace per authenticated issuer/subject, no workspace invitations or collaborative sharing. An existing OAuth 2.1 identity provider supplies authorization-code/PKCE and client registration. This server is an OAuth resource server, not a new identity provider. Rehearsal is default; live model authorization and evaluation remain separate.

Failure behavior: reject stale or cross-account operations; never retry mutation calls automatically; remount and clear client state on account changes. Read-only open never creates source. Source data is returned to the widget in MCP `_meta`, with only minimal summaries exposed to model context. Publishing means an immutable private audited BUILD artifact, not public web publication.

Authorization envelope: reversible code/dependency/test work and draft PR in the requested repository; no paid provisioning, credentials, permission expansion, deployment, merge, production migration or real inference calls.

## Repository integration authorization — 2026-10-01

The latest user instruction supersedes only the original draft-only/no-merge envelope: audit exact PR #2 head and hosted evidence, reconcile stale verification status, mark ready and merge when no repository-internal gate remains. SDK-08 still separates implementation and repository integration from external authorization. Vercel/Neon provisioning or deployment, production migration, OAuth-provider rollout, live ChatGPT connection/listing, paid inference, native OpenAI adoption and execution of the exclusive license remain outside this authorization.

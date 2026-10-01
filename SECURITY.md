# Security boundary and production acceptance

This is an enterprise-oriented integration module with tested controls, **not a claim of a completed security certification or production acceptance**. Review this document before exposing a deployment beyond loopback.

## Controls implemented

The reference service enforces signed RS256 host identity, exact issuer/audience/lifetime, tenant-scoped SQL queries, role checks, source-revision concurrency, section locks, actor-bound expiring proposals and atomic source/snapshot/history commits. Production refuses local identity and requires an exact HTTPS origin. Local identity binds only to loopback.

API requests validate Host and Origin and reject cross-site browser requests, including loopback DNS-rebinding attempts. JSON bodies and document/model outputs are bounded. Static serving uses an explicit path boundary and allowed extensions. Security headers disallow unsafe script evaluation and external framing, and add HSTS in production. Source markup is escaped and never executed as HTML. The minimal Markdown renderer does not fetch URLs or images.

Provider credentials stay on the server. The model receives no shell, browser, network tools or writable repository. Strict schema and runtime scope checks reject arbitrary patches. Provider failures are sanitized; request logs use a request ID and generic failure code, not source text or tokens. No silent retry can duplicate a billable generation. The per-process limiter permits 30 unsafe requests per actor per minute and at most one concurrent model operation per actor/eight overall.

## Threats these controls do not eliminate

Model instructions are not a mathematical objective function or a deterministic guarantee. Semantic reviewers may overlook contradictions, follow misleading source, or overstate what they understand. Literal evidence validation catches invented citations, not all reasoning failures. The exported BUILD contract itself is instruction-bearing source and must not be treated as permission to exceed the receiving agent’s authority.

SQLite and its WAL contain document text, proposals and history in plaintext. Storage encryption, host backups, export policy, retention, erasure, legal holds and incident response must be supplied by the operator. The hash chain is not externally anchored: a database administrator can rewrite or truncate it. There is no WORM ledger or SOC 2 claim.

Role scopes are per workspace, not per-document ACLs. The local mode trusts local processes and the development operator; it is not a multiuser security deployment. A browser user with access to a workspace can read its document context. Host token issuance, revocation, key rotation and membership policy remain outside the module. Remount on identity/workspace changes.

Rate limiting and model concurrency are instance-local. This reference is intentionally single-instance with persistent disk. Multi-instance operation requires a shared transactional store and distributed limits, not another copy of the SQLite file. Traffic quotas, storage growth policy and large-history pagination should be assessed against actual usage before an enterprise rollout.

`store: false` asks the Responses API not to persist the response as stored application state; it is not a contractual zero-data-retention setting. Verify the actual provider/account policy and regional processing requirements before sending sensitive content. No live provider call was made in local acceptance.

## Required deployment gate

1. Configure host SSO/session issuance, least-privilege roles, HTTPS/reverse proxy, exact Origin/Host behavior, short-lived tokens and key rotation. Test with real host claims; remove local identity.
2. Bind a persistent encrypted volume or replace the store with a host adapter preserving transaction, tenant, history and revision invariants. Run actual backup/restore and retention/erasure exercises.
3. Authorize the model/account, spending ceiling, data processing and retention. Evaluate scoped generation and both reviews with representative, adversarial and large real inputs; record source/model revisions and costs.
4. Exercise accessibility with assistive technology, real browser/network loading, native downloads, production traffic/load, dependency/runtime vulnerability review, monitoring, deployment and rollback. Unit tests do not substitute for these outcomes.

Do not expose the reference on an ephemeral Vercel Function filesystem. A host can serve the UI there while supplying an appropriate durable service, but that is a separate integration decision, not an existing deployment in this repository.

## Reporting

Do not post provider keys, host tokens, private source or exploit details affecting an unpatched deployment in a public issue. Use the repository’s private vulnerability-reporting feature when available. If it is not enabled, open a minimal issue asking the owner for a private channel without including sensitive details. No unverified security-contact address is invented here.

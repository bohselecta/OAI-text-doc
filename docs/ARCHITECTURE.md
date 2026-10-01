# Architecture and host integration

## Shape

```text
Host creation menu: Document
        │
<language-document> ── same-origin JSON API ── authenticated actor
        │                                      │
Draft sections                           Document service
        │                                ├── scope / revision / roles
explicit instruction                     ├── untrusted model adapter
        │                                ├── atomic SQLite store
proposal → accept                        └── history / snapshots / releases
        │                                      │
canonical source → deterministic compiler → structural audit
                                             │
                            optional semantic + fresh-reader reviews
                                             │
                           guarded release → BUILD.md / BUILD.txt
```

The implementation uses native ES modules and a custom element rather than requiring React, a design-system package or an OpenAI-internal SDK. `src/ui/document.mjs` owns the interaction; `src/core` owns schemas, profiles, compilation and source import; `src/server` owns authorization, inference and persistence. `DocumentModule` and `DOCUMENT_MANIFEST` are public integration exports. The manifest explicitly marks `nativeSpacesIntegration: false`.

The UI is a client, never the security boundary. Disabling a browser button is not authorization. All mutations are validated again by the server. The injected `authenticate` and `provider` arguments to `createApp` are **trusted host/test adapters**, never request parameters.

## Host contract

Serve the UI ES modules/styles/icon and API on the same origin. Mount with `embedded` to remove the reference host chrome; the original OpenAI shell is not copied into an internal runtime. The host registers the Document item using its own menu API and resolves the current document ID.

`configure({ apiBase, documentId, getAccessToken })` accepts a host token supplier, not a provider key. Configure before mounting. Remount the component when changing the authenticated identity or workspace, so source and proposals from a previous identity are not retained in UI memory. Access tokens remain in memory; they are never written to localStorage, source or exported files.

Production reference authentication validates **RS256**, an RSA public key of at least 2048 bits, exact issuer/audience, a maximum one-hour lifetime, expiration/not-before, subject, workspace and role. Token claims:

```json
{
  "sub": "host-user-id",
  "workspace_id": "workspace-id",
  "document_role": "editor",
  "iss": "https://identity.example",
  "aud": "document-module",
  "iat": 0,
  "exp": 0
}
```

The timestamps above describe the shape, not a usable token. `viewer` reads and runs structural checks; `editor` authors; `publisher` can author and publish; `admin` has the same document capabilities as publisher. Workspace membership/identity issuance remains the host’s responsibility. There is no document-level sharing invitation system or invented SSO service.

The reference verifier loads one public key at process start. Rotate it through a controlled restart; overlapping keysets, JWKS discovery, revocation and centralized session policy belong to a replacement host identity adapter. Do not advertise the reference as a complete identity platform.

Host events bubble across the shadow boundary:

- `document-changed`: `{ documentId, revision }`, after an accepted durable mutation.
- `document-published`: `{ documentId, releaseId, revision }`, after a stored audited release.

## Domain model

A document has a stable ID, title, profile IDs, revision, timestamps and 1–64 sections. Each section has `id`, `title`, `kind`, `content`, `locked` and declared `dependsOn` IDs. Current source is capped at 900,000 UTF-8 bytes, section content at 30,000 characters, instruction at 6,000 characters and imports at the HTTP request boundary. The reference workspace supports 200 documents.

Ten universal kinds are intent, outcome, audience, deliverables, requirements, constraints, structure, execution, verification and delivery. Six profiles add required kinds:

| Profile | Additional source roles | What model review is asked to examine |
|---|---|---|
| Software & interactive | Interaction, data, recovery, security | Observable flows, retained data, permission boundaries, meaningful verification. |
| Research & evidence | Method, evidence, alternatives | Attribution, uncertainty, competing explanations and falsification. |
| Writing & knowledge | Voice, continuity | Audience, argument, voice, internal coherence and editorial acceptance. |
| Visual & media | Direction, assets, continuity | Approved direction, rights, integration and representative visual inspection. |
| Business & operations | Operations, economics, recovery | Owners, permissions, economics, measures, rollout and failure handling. |
| Physical & spatial | Materials, safety, recovery | Dimensions, tolerances, fabrication and qualified physical validation. |

Profiles compose by a union of required kinds. Changing profiles adds missing sections but never deletes or rewrites existing content. Declarations are not a magic classifier: current profile selection is explicit. Likewise, requirement links are explicit REQ IDs; the application does not pretend that a regex extracted a complete semantic dependency graph.

## Mutation protocol

1. Read source revision N and select one unlocked section.
2. Submit an instruction plus section ID and N.
3. The service verifies workspace/role/scope/lock and permits at most one model operation per editor.
4. The model receives read-only source and returns only `{ sectionId, content }` under a strict schema.
5. The service validates the response, rechecks N after inference, and stores a 15-minute actor-bound proposal with source hash and before/after text.
6. Accept executes inside `BEGIN IMMEDIATE`: recheck actor, tenant, revision, hash, expiration and lock; change exactly one content field; write revision N+1, snapshot and history event atomically.
7. Repeated acceptance of the same proposal is idempotent. A different pending proposal at N becomes stale. Undo is another revision, not a deletion of evidence.

Neither model output nor client request contains a writable arbitrary JSON patch. Locks are authorship controls shared by workspace editors, not an administrative secrecy boundary.

## Compiler and audit

Compilation is deterministic for the same source, profile and target configuration. It orders typed sections into execution-oriented structure, adds handoff instructions, and preserves source content verbatim. Repetition is reported, not silently deleted. No lossy “minimum sufficient context” heuristic claims semantic safety.

Each source-map entry records section ID, content hash and line range in the **compiled body before the draft prefix and audit receipt**. `compiled.contentHash` hashes that body. `sourceHash` hashes the serialized source snapshot, including revision and metadata. These scopes are explicit so receivers do not mistake a body hash for a hash of the entire downloaded file.

Structural audit checks required stage presence, empty content, TODO/TBD/FIXME markers, software requirement IDs and acceptance references, orphan verification references, exact duplicate content, conflicting explicit `@decision key = value` statements, declared dependency cycles and budget overflow.

Model review is opt-in. Pass one sees source sections and profiles. A separate call sees only the compiled artifact as a fresh receiving builder. Both must list every section ID; every finding must quote literal text from a named source section. This rejects invented citations but **does not verify that the model actually reasoned correctly** or read every word. A separate call is not an independent scientific auditor.

A clean release requires current revision/hash, both completed reviews, no blocking findings, an in-budget complete file and explicit acknowledgment of warnings. Structural findings cannot be erased by model output. Source editing, target changes and budget changes invalidate the client’s current compile. Stored audits remain immutable historical evidence, not authority for newer source.

The export budget includes the receipt. UTF-8 bytes form a conservative ceiling for byte-based tokenization, not an exact count for every model. The target adapter does not invent a model’s context window, per-message cap or output limit. The host/user supplies a verified allowance plus a reserve. Over-budget source is never truncated; revise it explicitly or increase a verified allowance.

## API surface

All document routes are tenant-scoped and authenticated. Request schemas reject unknown fields. Unsafe requests require JSON. Errors have `{ error: { code, message, requestId } }` and do not echo credentials or source.

| Method/path under `/api` | Purpose |
|---|---|
| GET `/session`, `/documents` | Resolve actor/provider capabilities; list workspace documents. |
| POST `/documents` | Create example, typed template, model-authored brief or imported source. |
| GET `/documents/:id` | Current canonical source. |
| GET `/:id/history`, `/:id/backup` after `/documents` | Integrity-checked history; current-source JSON backup. |
| POST `/:id/proposals` | `{ sectionId, instruction, revision }`. |
| POST `/:id/accept` | `{ proposalId }`. |
| POST `/:id/undo`, `/:id/lock` | Section-scoped restore or explicit lock change, with revision. |
| POST `/:id/sections`, `/:id/profiles` | Explicit structural metadata changes with revision. |
| POST `/:id/audit` | `{ revision, target, budget: { context, reserve }, semantic }`. |
| POST `/:id/export` | `{ auditId, format: "md" | "txt" }`; always an explicitly labeled draft. |
| POST `/:id/publish` | `{ auditId, acknowledged: [findingId] }`; returns immutable release. |

GET `/healthz` is a minimal, non-sensitive liveness response. The reference static server serves only allowlisted UI file extensions, not source data or `.env` files.

## Model adapter

Only the server calls the OpenAI Responses endpoint. The model name is explicitly configured, not hardcoded to an unverified future product. Requests use `text.format.type = json_schema`, strict schemas, `store: false`, a bounded input payload and `max_output_tokens = 12000`. The adapter rejects incomplete, refused, malformed, oversized and scope-violating output. There are no tools available to the generation request and no automatic retry. Review generates two separately metered calls.

The default 400,000-byte provider input bound is separate from export capacity. It is a defensive application limit, not an entitlement or guarantee that the selected model accepts the input. Host adapters can provide another bounded configuration. A live-provider quality and billing evaluation remains necessary.

## Durable state and portability

SQLite schema version 1 contains tenant-scoped documents, snapshots, proposals, audits, releases and append-only-in-application history. Migration refuses a newer unknown schema. WAL, a busy timeout and synchronous transactions preserve revision boundaries in the single-instance reference deployment. Snapshots and history are not silently pruned.

The history chain includes previous event hash, source hash, actor and revision. An operator with database write access can rewrite the chain or truncate its tail; external anchoring and retention are host responsibilities. Current-source JSON export is not a full database/history backup. Use the operating procedure for disaster recovery.

## Primary references reviewed

- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs): Responses schema format, refusal and incomplete handling.
- [Codex AGENTS.md](https://developers.openai.com/codex/guides/agents-md/): configuration discovery is distinct from explicitly reading a BUILD file.
- [Node SQLite](https://nodejs.org/api/sqlite.html): native database API.
- [Web Components](https://developer.mozilla.org/en-US/docs/Web/API/Web_components): custom-element host surface.
- [OpenAI brand guidelines](https://openai.com/brand/): independent naming and no implied endorsement.

Reviewed 2026-09-30. These references establish API/design constraints, not evidence of OpenAI acceptance or a successful provider call from this repository.

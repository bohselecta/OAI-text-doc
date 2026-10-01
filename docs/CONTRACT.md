# Frozen product and acceptance contract — 1.0

The requested offering is **Document**, an instruction-native module proposed for the OpenAI Spaces creation menu. Language Canvas is the underlying authoring model. The empty repository was inspected before initialization; there were no pre-existing files, branches of implementation, migrations or working features to overwrite. The user’s latest request and actual source remain authoritative.

## Observable contract

| ID | Obligation | Acceptance evidence |
|---|---|---|
| DOC-01 | The reference menu adds Document; other host types are not falsely implemented. | Browser creation-menu check; manifest and explicit host boundary. |
| DOC-02 | A selected section is the only writable scope; document prose cannot be manually edited. | Browser DOM/keyboard checks; server wrong-section/extra-field/lock tests. |
| DOC-03 | Generation yields an untrusted proposal, not a commit. | HTTP and browser before/after source equality; explicit accept/discard. |
| DOC-04 | Acceptance checks actor, tenant, revision, source hash, expiration and lock inside a transaction. | Store/HTTP isolation, replay, stale request and rollback tests. |
| DOC-05 | History and undo preserve other sections and previous revisions. | SQLite restart, transaction rollback, chain tamper and browser undo checks. |
| DOC-06 | Draft is canonical; Publish is a separate derived view and cannot silently repair source. | Read-only audit test, source maps, source-hash binding and finding-to-Draft flow. |
| DOC-07 | Universal stages and composable domain profiles drive actual checks. | Six-profile/hybrid fixtures, missing-stage tests and browser profile change. |
| DOC-08 | Exports preserve every source section and state the checks actually run. | Source-line/hash assertions, full-file budget test, MD/TXT browser export checks. |
| DOC-09 | Audited release requires both model reviews, no blockers, current source and warning acknowledgment. | Positive and negative HTTP/store release tests, never bypassed by rehearsal. |
| DOC-10 | Authentication, authorization, model credentials and input boundaries reside on the server. | JWT/origin/host/tenant/role/schema/response-limit tests. |
| DOC-11 | The module supports errors, keyboard access, reduced motion and responsive layouts. | Chromium acceptance script; screenshot review at desktop/mobile sizes. |
| DOC-12 | The result is delivered with source, setup, evidence, legal boundary and host integration instructions. | README, AGENTS, architecture, security, status, operating notes and source bundle. |

## Rules that must not be negotiated away

No contenteditable, no manual document-content textarea, no whole-document patch from a section prompt, no automatic propagation. Source changes always invalidate the currently viewed audit. A locked decision is changed only after an explicit unlock. Inference errors never replace accepted text. A stale model response cannot overwrite a newer source revision.

A model review is a fallible assessment. A complete outline is not a complete project. Stable REQ identifiers establish references, not test quality. Exact duplicates and `@decision key = value` conflicts are deterministic checks; general semantic equivalence and contradiction detection belong to the model reviewer and may miss defects.

## Version-one boundaries

This is a working module, not a promise of access to OpenAI’s product internals. The reference host shell, local identity and SQLite adapter are deliberately replaceable boundaries. There is no invented native Spaces registration, enterprise certification, signed license, production deployment, external security review, participant study or successful live-provider run.

Draft metadata may create sections, compose profiles and lock decisions. There is no implicit global rewrite. Root-wide propagation, automated lossy condensation, arbitrary multi-file creation, live collaborative cursors, directory synchronization and external publication are not implemented. A repair that affects multiple sections is a series of explicitly scoped edits, not an accidental global permission grant.

One exported file contains the complete textual project contract, not executable asset bytes or the receiving builder itself. External assets, credentials and permissions must be stated as dependencies; exporting a plan cannot manufacture them.

## Finish criteria

A release candidate must pass `npm test`, `npm run build`, native-navigation Chromium acceptance and manual screenshot review. The exact tested revision and environment must be recorded. A deployment additionally requires the host-specific security/operations checklist, live-provider evaluation with authorized credentials and production smoke/rollback checks. These deployment checks cannot be inferred from unit tests.

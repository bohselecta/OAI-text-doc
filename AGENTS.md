# Document — agent entry point

Read `docs/CONTRACT.md`, `docs/ARCHITECTURE.md`, and `docs/STATUS.md` before changing implementation. The latest user direction and working source outrank historical proposals.

## Non-negotiable contract
- The host-facing creation item is **Document**. Language Canvas is its underlying authoring model.
- Draft is section-scoped, instruction-only authoring. No contenteditable or manual text-editing controls for document content. Instruction fields remain ordinary accessible text inputs.
- Model output is an untrusted proposal. Server-side scope, revision, lock, authorization, and schema checks govern every accepted change.
- Publish is a separate derived, immutable view; it never silently edits Draft. Single-file Markdown/plain-text export preserves normative source, provenance and audit limitations.
- Six composable domain profiles extend a universal outcome spine. Distinguish structural checks, semantic review, and real-world execution evidence.
- No model key in a browser. No paid provider calls by default. Rehearsal mode must be visibly identified and must not fabricate model-review evidence.
- This is an independent proposal for OpenAI, not an official OpenAI product or a claim of native Spaces integration. First-party code is reserved for an OpenAI-exclusive grant; do not add MIT/Apache licensing to it.
- Preserve source/history, reject stale writes, fail closed on security and audit gates. Do not weaken tests to claim completion.

## Checks
`npm test`, `npm run build`, and `python tests/browser.py` (with Chromium and Python Playwright installed). Check desktop, mobile, keyboard interaction, reduced motion, error/recovery and source-to-export integrity. Record exact evidence and untested deployment/provider assumptions in `docs/STATUS.md`.

Keep documentation concise and near code. No secrets, paid services, new provider entitlements, unsolicited outreach, production deployment or permissions expansion without authorization.

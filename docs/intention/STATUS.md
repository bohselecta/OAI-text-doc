# Whole-intention acceptance status

**Verified runtime, delivered as draft PR #3. No merge or deployment.**

Base: main `27022b797f8eae685438d61f226b327e22434546` after PR #2. Delivery: [draft PR #3](https://github.com/bohselecta/OAI-text-doc/pull/3), branch `feat/whole-intention-workspace`. Native Document and all 19 protected native/legal files remain byte-identical.

## Established evidence

- **PASS:** full local Node 24 suite, 315 passed / 1 expected real-Postgres-only skip
- **PASS:** 30 added state, provider, HTTP and client-logic checks, including exact source preservation, separate related approval, revision/actor isolation, SQLite restart, native Document compatibility, portable fork safety and stale-session cancellation
- **PASS:** native and hosted asset builds; self-contained HTML capsule build
- **PASS:** 16 ordinary Chromium behavior groups at `f582248ade91e342bafe767b723fffe5b974f8ae`, [run 36902664415](https://github.com/bohselecta/OAI-text-doc/actions/runs/36902664415), with zero page/console errors and zero live-provider calls; [recorded report](evidence/browser-f582248.json)
- **PASS:** actual downloaded HTML file opened offline, exact edits accepted, browser copy recovered, re-exported HTML reopened, zero network requests; malformed/hostile imports and literal script-like Unicode text tested through file execution
- **PASS:** independent source review found and resolved portability, accessibility, interrupted-input and host-session races; actual desktop/mobile/proposal/offline screenshots inspected
- **PASS:** all six exact-commit CI jobs: Node 22, Node 24, PostgreSQL 17, original native Chromium, MCP Apps Chromium, and whole-intention/offline Chromium. The final documentation/evidence commit does not change this runtime. See the draft PR checks for its packaging-head rerun.

## Screenshots

These are actual Chromium captures from the verified source. Local/offline views contain exact recorded user instructions. Connected-mode views use a visibly labelled deterministic test fixture, not paid inference.

- [Editable starting point](../images/intention-start.png)
- [Whole intention, local mode](../images/intention-whole-local.png)
- [Whole with material decision, fixture](../images/intention-whole-fixture.png)
- [Scoped and related approval, fixture](../images/intention-scoped-proposal.png)
- [Offline file after edit and re-export](../images/intention-offline.png)
- [390px mobile, fixture](../images/intention-mobile.png)

[Runtime hashes and local check provenance](evidence/runtime-15cd424.json) bind the source across the final test/evidence-only commits. No generated source was shortened or replaced to pass tests.

## Contract coverage

| Requirement | Evidence |
| --- | --- |
| INT-01 / INT-02 | One seed, whole preview, nested unfolding, parent/Back navigation and mobile whole navigation in native Chromium |
| INT-03 / INT-05 | Full-context provider fixture, wrong-scope rejection, two-phase approval, decline-related preservation and lock/CAS/actor checks |
| INT-04 | Material decisions surfaced/answered, stale answer retained; no forced question count |
| INT-06 / INT-07 | Structured source, complete capsule round trips, bounded base64 encoding, history, real offline execution and no-network checks |
| INT-08 | Real Responses adapter reused; strict fixture contract/refusal/failure tests and transparent unconfigured mode |
| INT-09 | SQLite restart/transactions, stale source, fork-safe local recovery, malformed import and interruption checks |
| INT-10 | Existing native-module SHA-256 regression checks |

## Boundaries

The development container cannot launch Chromium because its process socket is prohibited; normal GitHub Actions navigation is the browser evidence, not a policy workaround. DOM-stub tests prove client logic only.

Model replies used in tests and connected-mode screenshots are labelled deterministic fixtures. No live paid inference, deployment, ChatGPT listing/connection, new provider entitlement, executed agreement, production load/rollback test or human acceptance is claimed. Offline checks are structural/dependency checks; a configured model's semantic assessment is fallible. The capsule is an editable project record, not a signed audit, embedded AI or proof of execution.

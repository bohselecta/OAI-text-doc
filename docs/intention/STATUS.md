# Whole-intention acceptance status

**Functional workspace implemented; final exact-head CI and evidence packaging in progress.**

Base: main `27022b797f8eae685438d61f226b327e22434546` after PR #2. Delivery: [draft PR #3](https://github.com/bohselecta/OAI-text-doc/pull/3), branch `feat/whole-intention-workspace`. Native Document and all 19 protected native/legal files remain byte-identical.

## Established evidence

- **PASS:** full local Node 24 suite, 314 passed / 1 expected real-Postgres-only skip
- **PASS:** 29 added state, provider, HTTP and client-logic checks, including exact source preservation, separate related approval, revision/actor isolation, SQLite restart, native Document compatibility, portable fork safety and stale-session cancellation
- **PASS:** native and hosted asset builds; self-contained HTML capsule build
- **PASS:** 16 ordinary Chromium behavior groups at `60848650845dc8466e06ecdc33384ac45c6b33cc`, [run 36900088703](https://github.com/bohselecta/OAI-text-doc/actions/runs/36900088703), with zero page/console errors and zero live-provider calls; [recorded report](evidence/browser-6084865.json)
- **PASS:** actual downloaded HTML file opened offline, exact edits accepted, browser copy recovered, re-exported HTML reopened, zero network requests; malformed/hostile imports and literal script-like Unicode text tested through file execution
- **PASS:** independent source review found and resolved portability, accessibility, interrupted-input and host-session races; actual desktop/mobile/proposal/offline screenshots inspected
- **PENDING:** final head repeats all CI after the last session-safety, regression-test and documentation changes; final screenshot captures begin at the top of the page

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

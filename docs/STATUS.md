> **Hosted slice update:** Apps SDK + Vercel/Neon has a separate verified adapter; exact PR head `9a75e68283a799d9988b809489724e031851e537` passed Verify Document run `36799703761`. Repository integration is authorized through PR #2; external hosting and authorization remain separate. See [hosted acceptance](HOSTED-STATUS.md) and [setup](APPS-SDK-VERCEL-NEON.md). The original module status below is retained as baseline evidence.

# Current state — Document 1.0

**Working, enterprise-oriented reference module. Production host acceptance remains a separate gate.**

Implementation branch: `feat/document-language-canvas` in `bohselecta/OAI-text-doc`. The originally empty repository was initialized at `dbcf69b945af791bc3d73c3416eaa4667681917c`. No predecessor project was modified. Source hashes in [local verification](evidence/local-verification.json) identify the locally tested runtime independent of a later Git commit.

## Delivered

The custom element and Spaces reference shell run against a real Node HTTP service and durable SQLite store. Section proposals, explicit acceptance, locks, undo, history, creation, Markdown/plain-text/JSON import, six composable profiles, deterministic source-preserving compilation, structural auditing, live-provider review adapters, gated immutable release and text export are implemented. There is no manual source editing and no hidden whole-document mutation.

Host integration includes short-lived signed workspace identity, roles, exact-origin protections, transactional concurrency, bounded schemas/provider responses, fail-closed errors, original iconography, responsive dark/light UI, professional documentation, licensing instruments and recorded tests. The model adapter is actual server-side Responses API code; local acceptance never calls it with paid credentials.

## Evidence

| Check | Evidence and interpretation |
|---|---|
| Node domain, store, authorization, provider-contract and actual HTTP tests | **117 passed**, 0 failed/skipped in local Node 22.16.0. Includes negative scope, tenant, role, stale revision, origin/Host, refusal, malformed output and audit-release tests. Provider replies in these tests are explicit fixtures. |
| Runtime build | Syntax checks and a SHA-256 manifest for packaged runtime files. No bundler or external runtime packages. |
| Local Chromium component acceptance | **15 behavior groups passed**, 0 page errors, 0 provider calls. Actual component logic/CSS, real local HTTP service, 1536×1024 and 390×844 layouts, keyboard/reduced-motion, MD/TXT source-preserving exports, errors and recovery. |
| Local browser transport limitation | Managed Chromium blocked all URL navigation. The permitted in-memory page used a documented test-only HTTP bridge; resource loading, browser CSP enforcement and native downloads are **not** claimed from that run. No browser policy was disabled. |
| Native browser CI | [CI evidence](evidence/native-ci.md) records the normal-navigation run when completed. The default browser script uses real navigation and real downloads, not the local bridge. |
| Local workload measurements | [Benchmark](evidence/local-benchmark.json): 40 measured iterations after warmup at 17 sections and 64 sections/~647 KB, plus in-memory transactional commits. These are local measurements, not a production latency SLO or concurrent-load test. |
| Screenshot review | Actual Draft, scoped proposal, blocked/structural Publish, Spaces menu, mobile and light-theme output were inspected. CI recaptures these through ordinary navigation. |

The [evidence directory](evidence/) records exact runtime hashes and environment details. The dependency-free runtime uses Node's SQLite API, which emitted an experimental warning in local Node 22.16.0; CI also exercises Node 24.

## Not represented as completed

No live OpenAI inference or billing test, actual native Spaces integration, production SSO rollout, hosted deployment, distributed storage/load validation, external penetration test, assistive-technology study, participant study, physical verification or executed exclusive license is claimed. None of these can be inferred from screenshots or mock-provider tests.

The compiler currently preserves source rather than inventing a guaranteed-safe semantic compression algorithm. General semantic alignment is reviewed by a configured model and remains fallible. Explicit requirement references are not proof that a test is meaningful. Operators must satisfy [production acceptance](../SECURITY.md) before an enterprise deployment.

## Exact next step

Review the implementation PR and its CI at the delivered head. For adoption, register **Document** in an authorized host, bind real workspace identity and persistent storage, authorize a compatible provider and run the security/operations/live-model acceptance checklist. Complete the legal entity and owner signature before relying on the exclusive grant. No undocumented internal API, entitlement or signature should be invented to skip those gates.

# Whole-intention workspace · contract 1

User direction, 2026-10-01: begin with one editable intention and unfold its details only when useful. This additive workspace changes the application entry point; it does not rewrite the native-adoptable `<language-document>`.

| ID | Promise | Observable acceptance |
| --- | --- | --- |
| INT-01 | Start with one editable intention; a closed whole shows intention, current result, pending decisions. | New-project and closed-whole browser flows |
| INT-02 | Open nested parts, see their content and conversation, return to the whole without losing state. | Navigation, keyboard, mobile, refresh checks |
| INT-03 | Whole and selected-part scopes are explicit. Every development uses the entire current intention as context. | Provider request and wrong-scope tests |
| INT-04 | Routine elaboration stays inside the structure. Only material intent, constraint, or result decisions are surfaced. | Structured provider contract; visible decision answers retained |
| INT-05 | A selected-part proposal cannot alter another part. Related changes require a separate explicit acceptance after the local edit. | Before/after, stale, lock, cross-scope, decline tests |
| INT-06 | Intention, constraints, acceptance, decisions, nested document, conversations and revision history have one validated structured state. | Import/schema/graph/round-trip tests |
| INT-07 | A single HTML capsule works offline for exploration, instruction-based replacement, decisions and export. It never impersonates an LLM. | Actual downloaded HTML opened and edited, no network |
| INT-08 | A configured server provider makes real Responses requests with server-only credentials. Unconfigured mode is transparent and never fabricates inference. | HTTP contract/fixture and unconfigured behavior tests; live inference not claimed |
| INT-09 | Persist accepted state transactionally, reject stale revisions, recover previous source, fail without destroying work. | Store restart/CAS, malformed import, browser error/recovery |
| INT-10 | Preserve all 19 original native/legal files byte-for-byte. | Existing native-module regression suite |

Scope: new wrapper, state/reducer, local SQLite service, real optional model adapter, offline capsule, tests and documentation. Existing Apps SDK/Vercel/Neon adapter is preserved; the new workspace is not represented as deployed, listed, hosted, or connected to ChatGPT. No paid provider calls in tests, no credentials in exports, no auto-execution, no deployment or merge. Draft PR delivery only.

Document content remains instruction-authored. Local mode supports explicit `Replace with:` and `Append:` commands as deterministic proposals, plus recording part titles/structure. It does not pretend to understand arbitrary instructions. Whole-context semantic review is a fallible configured-model assessment, never proof; offline mode shows dependent-part checks and states that semantic review has not run. Source and state exports are portable records, not signed audit evidence or embedded AI.

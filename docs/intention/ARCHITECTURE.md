# Whole-intention layer

## Entry points and preservation

`npm run dev:intention` starts the additional whole-intention workspace and local SQLite service (default `http://127.0.0.1:4175`). `npm run dev` still starts the original native Document reference shell. Existing Apps SDK, MCP, Vercel and Neon routes are unchanged. The 19 native/legal files are checked against `docs/native-module-contract.json` on every test run.

The new surface owns an expanded, portable intention record. It does not masquerade as an audited native Document release, silently synchronize separate drafts, or rewrite the preserved custom element. Explicit native Document JSON export feeds accepted source into the original module's import/audit workflow. It preserves part IDs, source text, native roles, locks and dependency IDs, adds whole intention/boundaries/decisions and a tree map, and rejects native format limits rather than truncating. The export dialog makes the native profile explicit. Native JSON import retains every original section as a typed part; native Document is flat, and importing its JSON does not reconstruct capsule conversation/history. Use the full capsule for workspace round trips.

## State and mutation

`state.mjs` is a pure shared validator/reducer. Accepted source contains the editable intention, boundary lists, typed nested parts, declared dependencies and material decisions. Conversation, complete source-change snapshots, ordered revision events and at most one pending proposal travel in the record.

A model development receives the complete current record plus an explicit whole/part scope. Its strict result contains primary changes, separately proposed related changes, material questions and a whole-context assessment. The model cannot directly change the editable seed, constraints or acceptance. Every primary/related entry exposes title, kind, parent, dependencies and before/after source in review.

Primary acceptance changes only its allowed scope. Related work stays pending until a second approval. Each phase independently forms a valid tree; related work cannot be a hidden prerequisite for the primary edit. Locked source, unknown/extra fields, stale revisions, mismatched before-images and graph cycles are rejected. Source changes cannot silently erase an existing proposal. Restore creates a new revision and retains conversation/history.

`store.mjs` commits state and proposal-owner records in one SQLite transaction. It checks tenant, role, revision and requesting editor. Imports create a separate project identity. Schema versions newer than the implementation fail closed. There is no automatic history pruning or destructive cleanup route.

## Local, connected and offline behavior

- **Local service:** SQLite is authoritative. Exact `Replace with:` and `Append:` part instructions produce reviewable deterministic proposals. Arbitrary development fails explicitly; a conversation note does not generate a fake assistant answer.
- **Connected service:** `IntentionProvider` reuses the real server-side Responses adapter. Explicit model and server-only API key are required. Strict structured output, bounded requests, refusal/incomplete handling, timeout and `store:false` apply. No tools, execution or automatic paid retries are offered.
- **Offline capsule:** one HTML file contains a trusted bundled editor, styles and bounded base64 UTF-8 structured state. CSP forbids network connections, external scripts, frames and forms. No token, provider credential or live service configuration is exported. HTML imports are parsed as text; their scripts are never run.

A local edit checks the structure and declared dependent parts. The interface explicitly states that semantic whole-context review has not run. A configured model assessment is also fallible, not proof. Material-decision selection is instructed and reviewed, not claimed as a deterministic semantic guarantee.

## Recovery and session boundaries

Browser changes are stored under the project identity. Per-file selection and a browser-local project list make newly created/imported records discoverable after refresh. Portable imports always fork. An embedded file that diverges from saved history opens as a separate copy, even if its numeric revision is equal or greater. Full-state comparison and Web Locks (when available) protect local writes; browser storage remains best-effort and is not a multi-user transactional service. Storage failure is visible and the in-memory record can still be exported. Saving in the browser does not rewrite the downloaded HTML file.

Instruction, boundary, material-answer and modal drafts survive failed submissions. Explicit reload uses the saved version. Host token suppliers remain in memory. Reconfiguration clears old session source and cancels stale reads, mutations, deferred imports and exports before they can replace another session's visible project or save to the new session.

## Service boundary and limits

The service uses exact origin/host/fetch-site checks, reference JWT verification when configured, tenant separation and editor authorization. Local authentication is loopback-only and forbidden in production. Inference admission is one request per editor, eight globally; writes are limited to 30 per editor/minute. These are process-local safety controls, not a monetary budget or distributed quota. An actual deployment requires authenticated host integration, persistent storage, operational policy and authorized live-provider validation.

- 128 parts, 30,000 characters per part, 10,000-character intention
- 64 constraints and 64 acceptance items, each at most 2,000 characters
- 256 decisions; 1,000 conversation messages; 2,000 revision events
- 10 MB complete decoded record; a correspondingly bounded base64 HTML envelope
- Original native Document handoff limits: 64 sections, 100-character section titles, 30,000-character section content and 900 KB complete source

Limits fail explicitly and preserve the previous record. Exporting a project does not manufacture assets, execute a build, grant publication authority or prove acceptance.

## Run and verify

```sh
npm ci --ignore-scripts
npm run dev:intention
npm test
npm run build
npm run build:intention
python tests/intention_browser.py
```

The service inherits the existing `PORT`, `HOST`, `DOCUMENT_ORIGIN`, identity and provider settings. If an existing `.env` uses port 4173, the startup message shows that URL; use `PORT=4175 DOCUMENT_ORIGIN=http://127.0.0.1:4175 npm run dev:intention` to run alongside native Document. `INTENTION_DB` selects this workspace's SQLite file (default `data/intentions.sqlite`). The standalone starter is built at `dist/intention/language-canvas.capsule.html`.

Browser fixtures are isolated in `tests/intention-fixture.mjs`; no fixture is included in production server startup. DOM-stub client tests prove deterministic state/session logic only. Ordinary Chromium navigation, CSP, responsive layout, keyboard behavior, file downloads, actual offline file execution and screenshot inspection require the separate browser acceptance run.

# Document Apps adapter

This is a transport adapter around the unchanged `src/ui/document.mjs` custom
element. It retains the complete original independent reference shell so New,
Import, document switching, Draft and Publish remain reachable. It does not
register a native Spaces creation type or imply OpenAI endorsement.

## Server boundary

`handleAppsMcpRequest(req, res, options)` uses the actual MCP SDK stateless
Streamable HTTP transport. Before calling it, the HTTP host must validate the
request origin/host, authenticate the access token, and bound/parse JSON.
Pass `parsedBody`, the trusted `actor`, and
`dispatch(actor, { method, path, body }) -> { status, body, headers }`.
Service paths include `/api`. HTTP authentication is repeated per request.
The host may supply a server-trusted `authorizationChallenge` string. A service
`FORBIDDEN` response then includes `mcp/www_authenticate` only in result metadata,
allowing OAuth scope reauthorization without replaying the denied action.

- `open_document` is model-visible, read-only and attaches the UI resource
- `read_document_data` is app-only and permits a closed set of read operations
- `document_action` is app-only and validates a strict discriminated union of
  the original API's actions; it cannot execute arbitrary URLs or patches

App-only visibility and tool annotations are hints, not authorization. The
shared service and durable store still enforce roles, tenant boundaries,
revision/scope/lock checks, proposal ownership, and publication gates. The
action descriptor advertises all three workflow scopes; a read-only account
remains read-only until it is reauthorized with the required scopes.

Only operation status, document count and optional selected ID enter
`structuredContent`. Full session/source/proposal/audit/export data lives in
tool-result `_meta.languageCanvas`. The non-secret context hash fences requests
from an old account, workspace or role before service dispatch. It is not a
credential. OAuth tokens, provider keys and database credentials never enter
the resource HTML or widget.

## Widget boundary

`scripts/build-apps.mjs` bundles the official MCP Apps `App` client into
`dist/apps/apps-widget.js`. Publish that at `/apps/apps-widget.js`; serve the
original `document.mjs`, `presentation.mjs`, `document.css`, and `document.svg`
under `/ui/`, with static-asset CORS. `assetBase` may include a directory prefix.
No API fetch permission is declared in the resource CSP.

The widget dynamically imports the original module without transforming it.
It adapts only the mounted instance's `api` method to `App.callServerTool` and
its `download` method to the standard host `downloadFile` capability. It does
not intercept global fetch, replace prototypes, persist browser state, or send
document content to model context. A host without app-file download support
gets an explicit recoverable error rather than a false download success.

Handlers are installed before initialization. The newest bootstrap is retained
during module loading; duplicates and stale results are ignored. Failed startup
has a retry button. Account changes/teardown remove the prior element, erase
its private state, and fence in-flight results. No mutation is automatically
replayed after a transport failure. Loopback auto-example seeding is disabled
in Apps session metadata, so opening the read-only tool cannot create data.

## Evidence and limits

`node --test tests/apps*.test.mjs` exercises actual MCP registration and
Streamable HTTP, schemas and data minimization, complete shared-service edit /
export / publication-gate paths, plus lifecycle, stale-response, retry and
download behavior. Successful model reviews in tests are labeled fixtures.
Parent integration checks separately cover the actual sandboxed host browser,
OAuth verifier and Postgres store. These do not establish an approved ChatGPT
listing, a live OAuth deployment, paid-model quality, or production readiness.

Official references checked 2026-10-01:

- [MCP server and UI quickstart](https://developers.openai.com/plugins/build/app-quickstart)
- [Add UI to your MCP server](https://developers.openai.com/plugins/build/chatgpt-ui)
- [UI metadata reference](https://developers.openai.com/plugins/reference)

Current OpenAI documentation redirects the former Apps SDK routes to Plugins
and recommends the MCP Apps standard bridge over compatibility-only globals.

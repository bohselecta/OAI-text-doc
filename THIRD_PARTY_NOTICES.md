# Third-party notices

The first-party runtime declares no third-party npm dependencies. It uses Node.js built-in APIs and browser platform APIs. Node.js, SQLite, Chromium, Python, Playwright and GitHub Actions used to run or test the project remain subject to their respective licenses and terms; this repository does not relicense those projects exclusively to OpenAI.

The Document glyph and line icons are original SVG path artwork written for this implementation. Typography uses the device’s system fonts; no font files are redistributed. README screenshots are captures of the implemented application, not OpenAI’s internal product screenshots. The user-supplied Spaces screenshot informed placement but is not bundled as licensed first-party artwork.

OpenAI, ChatGPT, Codex, Antigravity, GitHub and other product names identify external products. Their owners retain all trademark rights. No logo license, partnership or endorsement is claimed.

If a future contribution adds external packages, fonts, photographs, generated assets with provider terms or other separately licensed material, preserve its provenance and license before integration. The exclusive offer can cover only rights actually controlled by the granting party.

## Hosted Apps SDK adapter dependencies

The optional hosted adapter adds the following separately licensed packages; their licenses do not alter the OpenAI-exclusive first-party grant. Exact transitive versions are recorded in package-lock.json. npm packages include their own license files; the browser build retains bundled legal comments.

- @modelcontextprotocol/sdk and @modelcontextprotocol/ext-apps: MIT
- @neondatabase/serverless: MIT
- jose: MIT
- ws: MIT
- zod: MIT
- esbuild (build only): MIT
- @electric-sql/pglite (development/test PostgreSQL): Apache-2.0; bundled PostgreSQL uses the PostgreSQL License
- pg (real PostgreSQL tests only): MIT

The production widget publishes only the MCP Apps bundle plus unchanged original module assets; no external font, analytics, model key or OAuth token is bundled.

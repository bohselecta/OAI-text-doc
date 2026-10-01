# Hosted slice acceptance

Baseline: main `22466c2df904486dd6e67cfc97550fd1a61b6bb8`. Work is additive outside the preserved native module. See [frozen requirements](HOSTED-CONTRACT.md).

Current acceptance is still in progress. Code and focused tests are implemented; final CI and independent review are required before completion.

- PASS: exact original `src` files and exclusive license/grant SHA-256 preservation regression
- PASS: original native tests and hosted service semantic parity
- PASS: OAuth adversarial suite, actual SDK MCP transport, metadata privacy, account fence and lifecycle tests
- PASS: embedded PostgreSQL persistence/restart tests and real PostgreSQL 18.4 concurrent connections/row locking (disposable loopback database, not Neon)
- PASS: hosted static build and unchanged UI asset hashes
- NOT_RUN here: native Chromium acceptance, due unavailable runnable browser in this sandbox; CI is configured to run both original and Apps browser journeys
- NOT_RUN: live ChatGPT host, real OAuth provider/consent/refresh, Neon network deployment, Vercel deployment, paid model inference and production rollback/load tests

No hosted services, credentials, grants or deployments were created. Rehearsal never passes the model-review publication gates.

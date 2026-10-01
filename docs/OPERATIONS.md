# Operating the reference service

## Local development

`npm start` uses `.env` when present and defaults to loopback, port 4173, local identity and rehearsal. It creates `data/document.sqlite` and its WAL files. No provider connection is attempted in rehearsal. `npm run build` creates `dist/` plus a SHA-256 runtime manifest; run `node dist/src/server/index.mjs` from the desired persistent working directory or keep the source entry point.

## Production host configuration

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=4173
DOCUMENT_ORIGIN=https://document.your-host.example
DOCUMENT_AUTH=jwt
DOCUMENT_JWT_PUBLIC_KEY_FILE=/run/document/identity-public.pem
DOCUMENT_JWT_ISSUER=https://identity.your-host.example
DOCUMENT_JWT_AUDIENCE=document-module
DOCUMENT_DB=/var/lib/document/document.sqlite
DOCUMENT_PROVIDER=openai
OPENAI_API_KEY=<server secret supplied by the host>
OPENAI_MODEL=<explicitly authorized compatible model>
```

The `.example` addresses and placeholders are illustrative, not existing infrastructure. Terminate TLS at a trusted reverse proxy and preserve the configured Host value. Do not trust client-supplied forwarding headers as identity. Remain on one service instance for the reference store. Choose runtime/container versions through the host’s patch policy.

Health: GET `/healthz` reports process availability only. It is not evidence that SSO, inference, storage capacity or external integrations are healthy. Fatal initialization errors stop startup rather than selecting a permissive fallback. SIGTERM/SIGINT drain HTTP requests for up to ten seconds before process exit.

## Backup and recovery

`document.canvas.json` from the UI is a **current-source portability export**, not a backup of proposals, snapshots, audits, releases or the event chain.

For a complete reference backup: stop the service, confirm the process has exited, copy the SQLite database and any remaining `-wal`/`-shm` companions as a consistent set to encrypted restricted backup storage, then restart. For no-downtime backup, use a qualified SQLite online-backup workflow supplied and tested by the operator; this repository does not claim that copying a live WAL is safe.

Restore into an isolated environment first, open with the same or a compatible schema version, check document counts/source hashes/history and run representative source/export checks. Only then replace the stopped production service’s data under the host’s recovery process. An unknown newer `user_version` is rejected rather than migrated backward.

Local automated evidence covers fresh initialization, transaction rollback, restart retention and source-export/import preservation. It is not a production disaster-recovery exercise.

## Releases and rollback

Pin the exact Git commit and retain its runtime manifest. Run unit/integration/browser checks against that revision. Record host identity configuration, model versions, data schema and live smoke results before acceptance. Version 1 initializes schema version 1 only; there is no destructive migration or automatic pruning.

Rollback source/runtime only when the database schema remains compatible. Take a consistent backup before any future migration. Do not restore older source by deleting history; use section restoration or a new imported document so authored work remains attributable.

## Budgets and limits

The UI’s capacity is a user-supplied handoff budget, not the provider’s request configuration. Context plus reserve must be validated against the receiving builder’s actual limits. Source over the allowance fails an audit gate without truncation.

Model operations have a separate conservative input bound and a response timeout. Retrying after a timeout can still incur another charge even if the prior provider operation completed remotely. Operator budget controls must reside in the provider account or a host gateway; the reference’s per-process concurrency limiter is not a billing guarantee.

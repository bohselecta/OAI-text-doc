-- Document PostgreSQL schema v1. Applied transactionally by migrate.mjs.
-- JSON is kept as TEXT deliberately: JSONB key reordering would change source
-- and event hashes. Tenant is part of every identity and relationship.
CREATE TABLE lc_tenants (
  tenant TEXT PRIMARY KEY
);
CREATE TABLE lc_documents (
  tenant TEXT NOT NULL REFERENCES lc_tenants(tenant),
  id TEXT NOT NULL,
  body TEXT NOT NULL,
  revision BIGINT NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  insertion_order BIGINT GENERATED ALWAYS AS IDENTITY,
  PRIMARY KEY (tenant, id),
  CHECK (body::jsonb ->> 'id' = id),
  CHECK ((body::jsonb ->> 'revision')::bigint = revision)
);
CREATE TABLE lc_snapshots (
  tenant TEXT NOT NULL,
  document TEXT NOT NULL,
  revision BIGINT NOT NULL CHECK (revision >= 1),
  body TEXT NOT NULL,
  PRIMARY KEY (tenant, document, revision),
  FOREIGN KEY (tenant, document) REFERENCES lc_documents(tenant, id)
);
CREATE TABLE lc_events (
  tenant TEXT NOT NULL,
  document TEXT NOT NULL,
  sequence BIGINT NOT NULL CHECK (sequence >= 1),
  body TEXT NOT NULL,
  hash TEXT NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (tenant, document, sequence),
  FOREIGN KEY (tenant, document) REFERENCES lc_documents(tenant, id)
);
CREATE TABLE lc_proposals (
  tenant TEXT NOT NULL,
  id TEXT NOT NULL,
  document TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (tenant, id),
  FOREIGN KEY (tenant, document) REFERENCES lc_documents(tenant, id)
);
CREATE TABLE lc_audits (
  tenant TEXT NOT NULL,
  id TEXT NOT NULL,
  document TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (tenant, id),
  UNIQUE (tenant, document, id),
  FOREIGN KEY (tenant, document) REFERENCES lc_documents(tenant, id)
);
CREATE TABLE lc_releases (
  tenant TEXT NOT NULL,
  id TEXT NOT NULL,
  document TEXT NOT NULL,
  audit TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (tenant, id),
  UNIQUE (tenant, document, audit),
  FOREIGN KEY (tenant, document) REFERENCES lc_documents(tenant, id),
  FOREIGN KEY (tenant, document, audit) REFERENCES lc_audits(tenant, document, id)
);
CREATE INDEX lc_proposals_document ON lc_proposals(tenant, document);
CREATE INDEX lc_audits_document ON lc_audits(tenant, document);
CREATE INDEX lc_documents_newest ON lc_documents(tenant, insertion_order DESC);

-- Shared across all serverless instances. Timestamps use the database clock.
CREATE TABLE lc_actor_rates (
  tenant TEXT NOT NULL REFERENCES lc_tenants(tenant),
  actor TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 1),
  PRIMARY KEY (tenant, actor)
);
CREATE TABLE lc_inference_leases (
  tenant TEXT NOT NULL REFERENCES lc_tenants(tenant),
  actor TEXT NOT NULL,
  token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant, actor)
);
CREATE INDEX lc_inference_expiration ON lc_inference_leases(tenant, expires_at);

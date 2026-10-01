import { randomUUID } from 'node:crypto';
import { authorize, fail, requireRevision, validateDocument } from '../../core/contracts.mjs';
import { sha, sourceHash } from '../../core/compiler.mjs';
import { exportText } from '../export.mjs';
import { transaction } from './transaction.mjs';

/**
 * Async Store equivalent for PostgreSQL, including Neon Pool.
 * All changes/history use one transaction and a document row lock. Callbacks
 * receive only a cloned document; provider calls belong outside transactions.
 * The injected pool must implement pg's connect/query/end contract.
 */
export class NeonStore {
  constructor({ pool, ownsPool = false } = {}) {
    if (!pool?.connect || !pool?.query) throw new TypeError('NeonStore requires a pg-compatible pool.');
    this.pool = pool;
    this.ownsPool = ownsPool;
  }

  async close() { if (this.ownsPool) await this.pool.end(); }

  async ready() {
    let result;
    try { result = await this.pool.query('SELECT version FROM lc_schema_version WHERE singleton = 1'); }
    catch (error) {
      if (error.code === '42P01') fail(500, 'MIGRATION', 'Run the Document PostgreSQL migration before starting the service.');
      throw error;
    }
    if (result.rows[0]?.version !== 1) fail(500, 'MIGRATION', 'The Document PostgreSQL schema version is not supported.');
    return this;
  }

  async list(actor) {
    authorize(actor, 'read');
    const { rows } = await this.pool.query('SELECT body FROM lc_documents WHERE tenant = $1 ORDER BY insertion_order DESC', [actor.tenant]);
    return rows.map(row => {
      const d = JSON.parse(row.body);
      return { id: d.id, title: d.title, profiles: d.profiles, revision: d.revision, updatedAt: d.updatedAt };
    });
  }

  async #get(client, actor, id, lock = false) {
    authorize(actor, 'read');
    const { rows: [row] } = await client.query(`SELECT body FROM lc_documents WHERE tenant = $1 AND id = $2${lock ? ' FOR UPDATE' : ''}`, [actor.tenant, id]);
    if (!row) fail(404, 'NOT_FOUND', 'Document not found in this workspace.');
    return validateDocument(JSON.parse(row.body));
  }

  async get(actor, id) { return this.#get(this.pool, actor, id); }

  async #tenant(client, tenant) {
    // A real row lock covers the empty-workspace case; document locks alone
    // cannot serialize concurrent creation near the 200-document limit.
    await client.query('INSERT INTO lc_tenants (tenant) VALUES ($1) ON CONFLICT (tenant) DO NOTHING', [tenant]);
    await client.query('SELECT tenant FROM lc_tenants WHERE tenant = $1 FOR UPDATE', [tenant]);
  }

  async #event(client, actor, doc, type, detail = {}) {
    const { rows: [last] } = await client.query('SELECT sequence, hash FROM lc_events WHERE tenant = $1 AND document = $2 ORDER BY sequence DESC LIMIT 1', [actor.tenant, doc.id]);
    const entry = { sequence: Number(last?.sequence ?? 0) + 1, previousHash: last?.hash ?? null, documentId: doc.id, revision: doc.revision, sourceHash: sourceHash(doc), actor: actor.sub, type, detail, at: new Date().toISOString() };
    const body = JSON.stringify(entry), hash = sha(body);
    await client.query('INSERT INTO lc_events (tenant, document, sequence, body, hash) VALUES ($1, $2, $3, $4, $5)', [actor.tenant, doc.id, entry.sequence, body, hash]);
  }

  async #snapshot(client, actor, doc) {
    await client.query('INSERT INTO lc_snapshots (tenant, document, revision, body) VALUES ($1, $2, $3, $4)', [actor.tenant, doc.id, doc.revision, JSON.stringify(doc)]);
  }

  async create(actor, doc) {
    authorize(actor, 'write');
    validateDocument(doc);
    // Freeze caller-owned input before any await; JSON order stays unchanged.
    const input = structuredClone(doc);
    return transaction(this.pool, async client => {
      await this.#tenant(client, actor.tenant);
      const { rows: [count] } = await client.query('SELECT count(*) AS count FROM lc_documents WHERE tenant = $1', [actor.tenant]);
      if (Number(count.count) >= 200) fail(409, 'LIMIT', 'This reference workspace supports at most 200 documents.');
      await client.query('INSERT INTO lc_documents (tenant, id, body, revision) VALUES ($1, $2, $3, $4)', [actor.tenant, input.id, JSON.stringify(input), input.revision]);
      await this.#snapshot(client, actor, input);
      await this.#event(client, actor, input, 'created');
      return input;
    });
  }

  async #commit(client, actor, doc, type, detail, change) {
    const next = structuredClone(doc);
    await change(next);
    next.revision++;
    next.updatedAt = new Date().toISOString();
    validateDocument(next);
    const { rows } = await client.query('UPDATE lc_documents SET body = $1, revision = $2 WHERE tenant = $3 AND id = $4 AND revision = $5 RETURNING id', [JSON.stringify(next), next.revision, actor.tenant, doc.id, doc.revision]);
    if (rows.length !== 1) fail(409, 'REVISION_CONFLICT', 'The document changed. Refresh and review the latest version; your instruction has been kept.');
    await this.#snapshot(client, actor, next);
    await this.#event(client, actor, next, type, detail);
    return next;
  }

  async mutate(actor, id, revision, type, detail, change) {
    authorize(actor, 'write');
    return transaction(this.pool, async client => {
      const doc = await this.#get(client, actor, id, true);
      requireRevision(doc, revision);
      return this.#commit(client, actor, doc, type, detail, change);
    });
  }

  async addProposal(actor, doc, section, instruction, replacement, model) {
    authorize(actor, 'write');
    const input = structuredClone(doc), selected = structuredClone(section);
    return transaction(this.pool, async client => {
      const current = await this.#get(client, actor, input.id, true);
      requireRevision(current, input.revision);
      const proposal = { id: randomUUID(), documentId: input.id, sectionId: selected.id, revision: input.revision, sourceHash: sourceHash(input), before: selected.content, after: replacement, instruction, model, actor: actor.sub, expiresAt: Date.now() + 15 * 60 * 1000, status: 'pending' };
      await client.query('INSERT INTO lc_proposals (tenant, id, document, body) VALUES ($1, $2, $3, $4)', [actor.tenant, proposal.id, input.id, JSON.stringify(proposal)]);
      return proposal;
    });
  }

  async accept(actor, id, proposalId) {
    authorize(actor, 'write');
    return transaction(this.pool, async client => {
      // Consistent document-before-proposal lock order prevents deadlocks.
      const doc = await this.#get(client, actor, id, true);
      const { rows: [row] } = await client.query('SELECT body FROM lc_proposals WHERE tenant = $1 AND id = $2 AND document = $3 FOR UPDATE', [actor.tenant, proposalId, id]);
      if (!row) fail(404, 'NOT_FOUND', 'Proposal not found.');
      const p = JSON.parse(row.body);
      if (p.actor !== actor.sub) fail(403, 'FORBIDDEN', 'Only the requesting editor can accept this proposal.');
      if (p.status === 'accepted') return doc;
      if (p.expiresAt <= Date.now()) fail(410, 'EXPIRED', 'This proposal expired. Ask for a new proposal.');
      requireRevision(doc, p.revision);
      if (sourceHash(doc) !== p.sourceHash) fail(409, 'SOURCE_CHANGED', 'The proposal no longer matches its source.');
      const section = doc.sections.find(s => s.id === p.sectionId);
      if (!section || section.locked) fail(423, 'LOCKED', 'Unlock the selected section before proposing a change.');
      const next = await this.#commit(client, actor, doc, 'section.changed', { sectionId: p.sectionId, instruction: p.instruction, model: p.model, proposalId: p.id, beforeHash: sha(p.before), afterHash: sha(p.after) }, d => { d.sections.find(s => s.id === p.sectionId).content = p.after; });
      p.status = 'accepted'; p.appliedRevision = next.revision;
      await client.query('UPDATE lc_proposals SET body = $1 WHERE tenant = $2 AND id = $3', [JSON.stringify(p), actor.tenant, p.id]);
      return next;
    });
  }

  async undo(actor, id, revision, sectionId) {
    authorize(actor, 'write');
    return transaction(this.pool, async client => {
      const doc = await this.#get(client, actor, id, true);
      requireRevision(doc, revision);
      return this.#commit(client, actor, doc, 'section.restored', { sectionId }, async next => {
        const section = next.sections.find(s => s.id === sectionId);
        if (!section) fail(404, 'NOT_FOUND', 'Section not found.');
        if (section.locked) fail(423, 'LOCKED', 'Unlock the section before restoring it.');
        const { rows } = await client.query('SELECT body FROM lc_snapshots WHERE tenant = $1 AND document = $2 AND revision < $3 ORDER BY revision DESC', [actor.tenant, id, revision]);
        const previous = rows.map(r => JSON.parse(r.body).sections.find(s => s.id === sectionId)).find(s => s && s.content !== section.content);
        if (!previous) fail(409, 'NO_HISTORY', 'No previous content exists for this section.');
        section.content = previous.content;
      });
    });
  }

  async history(actor, id) {
    await this.get(actor, id);
    const { rows } = await this.pool.query('SELECT body, hash FROM lc_events WHERE tenant = $1 AND document = $2 ORDER BY sequence', [actor.tenant, id]);
    let previous = null, valid = true;
    return { entries: rows.map(row => {
      const entry = JSON.parse(row.body);
      if (sha(row.body) !== row.hash || entry.previousHash !== previous) valid = false;
      previous = row.hash;
      return { ...entry, hash: row.hash };
    }), valid, headHash: previous };
  }

  async saveAudit(actor, doc, audit) {
    authorize(actor, 'read');
    const input = structuredClone(doc), suppliedAudit = structuredClone(audit);
    return transaction(this.pool, async client => {
      const current = await this.#get(client, actor, input.id, true);
      requireRevision(current, input.revision);
      const report = { ...suppliedAudit, id: randomUUID(), documentId: input.id, revision: input.revision, sourceHash: sourceHash(input), createdAt: new Date().toISOString() };
      await client.query('INSERT INTO lc_audits (tenant, id, document, body) VALUES ($1, $2, $3, $4)', [actor.tenant, report.id, input.id, JSON.stringify(report)]);
      await this.#event(client, actor, input, 'audit.completed', { auditId: report.id, semantic: report.semantic.status });
      return report;
    });
  }

  async #getAudit(client, actor, id, aid) {
    const { rows: [row] } = await client.query('SELECT body FROM lc_audits WHERE tenant = $1 AND document = $2 AND id = $3', [actor.tenant, id, aid]);
    if (!row) fail(404, 'NOT_FOUND', 'Audit not found.');
    return JSON.parse(row.body);
  }

  async getAudit(actor, id, aid) {
    await this.get(actor, id);
    return this.#getAudit(this.pool, actor, id, aid);
  }

  async release(actor, id, aid, acknowledged = []) {
    authorize(actor, 'publish');
    return transaction(this.pool, async client => {
      const doc = await this.#get(client, actor, id, true), audit = await this.#getAudit(client, actor, id, aid);
      requireRevision(doc, audit.revision);
      if (sourceHash(doc) !== audit.sourceHash) fail(409, 'STALE_AUDIT', 'Audit source has changed.');
      if (!audit.compiled.budget.fits || audit.findings.some(f => f.severity === 'blocker') || audit.semantic.status !== 'completed' || audit.freshReader.status !== 'completed') fail(409, 'AUDIT_BLOCKED', 'Resolve blockers and complete both model reviews before publishing an audited release.');
      const warnings = audit.findings.filter(f => f.severity === 'warning').map(f => f.id);
      if (warnings.some(id => !acknowledged.includes(id))) fail(409, 'ACKNOWLEDGEMENT', 'Explicitly acknowledge each remaining warning.');
      const { rows: [existing] } = await client.query('SELECT body FROM lc_releases WHERE tenant = $1 AND document = $2 AND audit = $3', [actor.tenant, id, aid]);
      if (existing) return JSON.parse(existing.body);
      const release = { id: randomUUID(), documentId: id, revision: doc.revision, auditId: aid, sourceHash: audit.sourceHash, createdAt: new Date().toISOString(), publisher: actor.sub, acknowledged: warnings, content: exportText(audit, true) };
      await client.query('INSERT INTO lc_releases (tenant, id, document, audit, body) VALUES ($1, $2, $3, $4, $5)', [actor.tenant, release.id, id, aid, JSON.stringify(release)]);
      await this.#event(client, actor, doc, 'release.published', { releaseId: release.id, auditId: aid, acknowledged: warnings });
      return release;
    });
  }

  /** Fixed one-minute actor window, evaluated atomically by PostgreSQL. */
  async meter(actor) {
    authorize(actor, 'read');
    const count = await transaction(this.pool, async client => {
      await client.query('INSERT INTO lc_tenants (tenant) VALUES ($1) ON CONFLICT (tenant) DO NOTHING', [actor.tenant]);
      const { rows: [row] } = await client.query(`INSERT INTO lc_actor_rates (tenant, actor, window_start, count)
        VALUES ($1, $2, clock_timestamp(), 1)
        ON CONFLICT (tenant, actor) DO UPDATE SET
          count = CASE WHEN lc_actor_rates.window_start <= clock_timestamp() - INTERVAL '1 minute' THEN 1 ELSE least(lc_actor_rates.count + 1, 31) END,
          window_start = CASE WHEN lc_actor_rates.window_start <= clock_timestamp() - INTERVAL '1 minute' THEN clock_timestamp() ELSE lc_actor_rates.window_start END
        RETURNING count`, [actor.tenant, actor.sub]);
      return row.count;
    });
    if (count > 30) fail(429, 'RATE_LIMIT', 'Too many changes in one minute. Try again shortly.');
    return `${actor.tenant}/${actor.sub}`;
  }

  /** Lease survives crashed instances; a stale release cannot clear a new lease. */
  async acquireInference(actor) {
    authorize(actor, 'write');
    const tenant = actor.tenant, sub = actor.sub, token = randomUUID();
    await transaction(this.pool, async client => {
      await this.#tenant(client, tenant);
      await client.query('DELETE FROM lc_inference_leases WHERE tenant = $1 AND expires_at <= clock_timestamp()', [tenant]);
      const { rows: [same] } = await client.query('SELECT actor FROM lc_inference_leases WHERE tenant = $1 AND actor = $2', [tenant, sub]);
      if (same) fail(409, 'BUSY', 'A model operation is already running for this editor.');
      const { rows: [count] } = await client.query('SELECT count(*) AS count FROM lc_inference_leases WHERE tenant = $1', [tenant]);
      if (Number(count.count) >= 8) fail(503, 'CAPACITY', 'The model queue is full. Try again shortly.');
      await client.query("INSERT INTO lc_inference_leases (tenant, actor, token, expires_at) VALUES ($1, $2, $3, clock_timestamp() + INTERVAL '180 seconds')", [tenant, sub, token]);
    });
    return async () => {
      await this.pool.query('DELETE FROM lc_inference_leases WHERE tenant = $1 AND actor = $2 AND token = $3', [tenant, sub, token]);
    };
  }
}

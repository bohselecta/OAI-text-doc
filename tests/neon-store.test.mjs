import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { NeonStore } from '../src/adapters/neon/store.mjs';
import { createNeonStore } from '../src/adapters/neon/index.mjs';
import { migrateNeon } from '../src/adapters/neon/migrate.mjs';
import { transaction } from '../src/adapters/neon/transaction.mjs';
import { Store, exportText as sqliteExportText } from '../src/server/store.mjs';
import { exportText } from '../src/adapters/export.mjs';
import { example, RECOVERY, template } from '../src/core/templates.mjs';
import { compile, structuralAudit, sourceHash, sha } from '../src/core/compiler.mjs';

// Default: genuine embedded PostgreSQL SQL/transaction semantics, but ONE
// connection. This harness serializes checkouts and DOES NOT establish row-lock
// contention or Neon networking behavior. Set DOCUMENT_TEST_DATABASE_URL to a
// disposable PostgreSQL database to run the same tests with real pg connections.
function embeddedPool(db) {
  let queue = Promise.resolve();
  const pool = {
    async connect() {
      let unlock;
      const wait = queue;
      queue = new Promise(resolve => { unlock = resolve; });
      await wait;
      let released = false;
      return {
        async query(sql, params) {
          const result = params?.length ? await db.query(sql, params) : (await db.exec(sql)).at(-1);
          return { ...result, rows: result.rows ?? [], rowCount: result.affectedRows ?? result.rows?.length ?? 0 };
        },
        release() { if (!released) { released = true; unlock(); } }
      };
    },
    async query(sql, params) {
      const client = await pool.connect();
      try { return await client.query(sql, params); } finally { client.release(); }
    },
    async end() { await queue; await db.close(); }
  };
  return pool;
}

const realPostgres = Boolean(process.env.DOCUMENT_TEST_DATABASE_URL);
let pool, cleanup;
before(async () => {
  if (realPostgres) {
    const { Pool } = await import('pg');
    const schema = `document_test_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString: process.env.DOCUMENT_TEST_DATABASE_URL, max: 1 });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: process.env.DOCUMENT_TEST_DATABASE_URL, options: `-c search_path=${schema}`, max: 12 });
    cleanup = async () => { await pool.end(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); };
  } else {
    pool = embeddedPool(await PGlite.create());
    cleanup = () => pool.end();
  }
  await migrateNeon(pool);
});
after(async () => { await cleanup?.(); });

function input() { const d = example(); d.sections.find(s => s.id === 'recovery').content = RECOVERY; return d; }
async function setup() {
  const actor = { sub: 'alice', tenant: randomUUID(), role: 'admin' };
  const s = new NeonStore({ pool }), peer = new NeonStore({ pool });
  const d = await s.create(actor, input());
  return { s, peer, d, actor, other: { ...actor, tenant: randomUUID() } };
}
function proposal(s, actor, d, id = 'intent', after = 'A clearer goal.') { return s.addProposal(actor, d, d.sections.find(s => s.id === id), 'Make it clearer.', after, 'test-fixture'); }
function validAudit(d) {
  const compiled = compile(d), structural = structuralAudit(d, compiled);
  return { compiled, structural, findings: structural.findings, semantic: { status: 'completed', model: 'test-fixture' }, freshReader: { status: 'completed', model: 'test-fixture' } };
}
const code = expected => error => error.code === expected;
async function rows(table, actor, document) {
  const column = table === 'lc_documents' ? 'id' : 'document';
  return (await pool.query(`SELECT * FROM ${table} WHERE tenant = $1 AND ${column} = $2`, [actor.tenant, document])).rows;
}

// All document/editor inputs and provider results below are local fixtures.
test('PostgreSQL migration is idempotent and rejects an unknown newer schema', async () => {
  assert.equal(await migrateNeon(pool), 1);
  const s = new NeonStore({ pool });
  assert.equal(await s.ready(), s);
  await pool.query('UPDATE lc_schema_version SET version = 99');
  try {
    await assert.rejects(migrateNeon(pool), code('MIGRATION'));
    await assert.rejects(s.ready(), code('MIGRATION'));
  } finally { await pool.query('UPDATE lc_schema_version SET version = 1'); }
});

test('PostgreSQL stores exact JSON serialization, source hashes, ordering and snapshot bytes', async () => {
  const { s, d, actor, other } = await setup();
  d.sections[0].content += '\n日本語 🚀 e\u0301\n  literal indentation\n';
  d.id = randomUUID();
  await s.create(actor, d);
  const stored = await s.get(actor, d.id);
  assert.equal(JSON.stringify(stored), JSON.stringify(d));
  assert.equal(sourceHash(stored), sourceHash(d));
  assert.equal((await rows('lc_snapshots', actor, d.id))[0].body, JSON.stringify(d));
  assert.equal((await s.list(actor))[0].id, d.id);
  assert.deepEqual(await s.list(other), []);
  await assert.rejects(s.get(other, d.id), code('NOT_FOUND'));
});

test('PostgreSQL accepted proposal changes exactly one section and mirrors SQLite export bytes', async () => {
  const { s, d, actor } = await setup(), p = await proposal(s, actor, d);
  const next = await s.accept(actor, d.id, p.id);
  assert.equal(next.revision, 2);
  for (const section of d.sections) {
    const changed = next.sections.find(x => x.id === section.id);
    assert.deepEqual(changed, section.id === 'intent' ? { ...section, content: 'A clearer goal.' } : section);
  }
  const report = { ...validAudit(next), sourceHash: sourceHash(next) };
  assert.equal(exportText(report), sqliteExportText(report));
  assert.equal(exportText(report, true), sqliteExportText(report, true));
  const history = await s.history(actor, d.id);
  assert.equal(history.valid, true);
  assert.equal(history.entries[1].detail.beforeHash, sha(d.sections[0].content));
  assert.equal(history.entries[1].detail.afterHash, sha('A clearer goal.'));
});

test('PostgreSQL actor, tenant and role guards reject proposal replay', async () => {
  const { s, d, actor, other } = await setup(), p = await proposal(s, actor, d);
  await assert.rejects(s.accept({ ...actor, sub: 'bob' }, d.id, p.id), code('FORBIDDEN'));
  await assert.rejects(s.accept(other, d.id, p.id), code('NOT_FOUND'));
  const viewer = { ...actor, role: 'viewer' };
  assert.deepEqual(await s.get(viewer, d.id), d);
  for (const operation of [() => s.accept(viewer, d.id, p.id), () => s.create(viewer, input()), () => s.addProposal(viewer, d, d.sections[0], 'Change', 'New', 'fixture'), () => s.mutate(viewer, d.id, 1, 'bad', {}, () => {})]) {
    await assert.rejects(operation(), code('FORBIDDEN'));
  }
  assert.deepEqual(await s.get(actor, d.id), d);
});

test('PostgreSQL composite keys isolate identical document IDs across tenants', async () => {
  const { s, d, actor, other } = await setup();
  const alternate = { ...structuredClone(d), title: 'Other workspace private source' };
  await s.create(other, alternate);
  const p = await proposal(s, actor, d);
  await assert.rejects(s.accept(other, d.id, p.id), code('NOT_FOUND'));
  await s.accept(actor, d.id, p.id);
  assert.deepEqual(await s.get(other, d.id), alternate);
  assert.equal((await s.history(other, d.id)).entries.length, 1);
});

test('PostgreSQL locks, expired proposals, stale revision and source hash all fail without writes', async () => {
  const { s, d, actor } = await setup();
  const locked = await proposal(s, actor, d, 'constraints');
  await assert.rejects(s.accept(actor, d.id, locked.id), code('LOCKED'));
  const expired = await proposal(s, actor, d);
  expired.expiresAt = 0;
  await pool.query('UPDATE lc_proposals SET body = $1 WHERE tenant = $2 AND id = $3', [JSON.stringify(expired), actor.tenant, expired.id]);
  await assert.rejects(s.accept(actor, d.id, expired.id), code('EXPIRED'));
  const badHash = await proposal(s, actor, d);
  badHash.sourceHash = '0'.repeat(64);
  await pool.query('UPDATE lc_proposals SET body = $1 WHERE tenant = $2 AND id = $3', [JSON.stringify(badHash), actor.tenant, badHash.id]);
  await assert.rejects(s.accept(actor, d.id, badHash.id), code('SOURCE_CHANGED'));
  assert.deepEqual(await s.get(actor, d.id), d);
  const stale = await proposal(s, actor, d, 'outcome');
  await s.accept(actor, d.id, (await proposal(s, actor, d)).id);
  await assert.rejects(s.accept(actor, d.id, stale.id), code('REVISION_CONFLICT'));
  await assert.rejects(proposal(s, actor, d), code('REVISION_CONFLICT'));
  assert.equal((await s.history(actor, d.id)).entries.length, 2);
});

test('PostgreSQL repeated acceptance is idempotent even after an unrelated later edit', async () => {
  const { s, d, actor } = await setup(), p = await proposal(s, actor, d);
  const next = await s.accept(actor, d.id, p.id);
  const newer = await s.accept(actor, d.id, (await proposal(s, actor, next, 'outcome', 'A new outcome.')).id);
  assert.deepEqual(await s.accept(actor, d.id, p.id), newer);
  assert.equal((await s.history(actor, d.id)).entries.length, 3);
});

test('PostgreSQL undo restores only the selected section as a new durable revision', async () => {
  const { s, d, actor } = await setup();
  const next = await s.accept(actor, d.id, (await proposal(s, actor, d)).id);
  const newer = await s.accept(actor, d.id, (await proposal(s, actor, next, 'outcome', 'New outcome.')).id);
  const restored = await s.undo(actor, d.id, newer.revision, 'intent');
  assert.equal(restored.sections[0].content, d.sections[0].content);
  assert.equal(restored.sections[1].content, 'New outcome.');
  assert.equal(restored.revision, 4);
  assert.equal((await rows('lc_snapshots', actor, d.id)).length, 4);
  await assert.rejects(s.undo(actor, d.id, 4, 'absent'), code('NOT_FOUND'));
  await assert.rejects(s.undo(actor, d.id, 4, 'constraints'), code('LOCKED'));
  await assert.rejects(s.undo(actor, d.id, 4, 'audience'), code('NO_HISTORY'));
});

test('PostgreSQL callback failure rolls back source, snapshots and history', async () => {
  const { s, d, actor } = await setup();
  await assert.rejects(s.mutate(actor, d.id, 1, 'failed', {}, next => { next.sections[0].content = 'New'; throw new Error('Injected callback failure'); }), /Injected/);
  assert.deepEqual(await s.get(actor, d.id), d);
  assert.equal((await rows('lc_snapshots', actor, d.id)).length, 1);
  assert.equal((await s.history(actor, d.id)).entries.length, 1);
});

test('PostgreSQL failure after snapshot insertion rolls back acceptance and proposal status', async () => {
  const { s, d, actor } = await setup(), p = await proposal(s, actor, d);
  const broken = new NeonStore({ pool: {
    query: (...args) => pool.query(...args),
    async connect() {
      const client = await pool.connect();
      return { release: e => client.release(e), query(sql, values) {
        if (sql.startsWith('INSERT INTO lc_events')) throw new Error('Injected event failure');
        return client.query(sql, values);
      } };
    }
  } });
  await assert.rejects(broken.accept(actor, d.id, p.id), /Injected event failure/);
  assert.deepEqual(await s.get(actor, d.id), d);
  assert.equal((await rows('lc_snapshots', actor, d.id)).length, 1);
  assert.equal((await s.history(actor, d.id)).entries.length, 1);
  assert.equal(JSON.parse((await rows('lc_proposals', actor, d.id))[0].body).status, 'pending');
  assert.equal((await s.accept(actor, d.id, p.id)).revision, 2);
});

test('PostgreSQL history validates stored byte hashes and detects altered entries', async () => {
  const { s, d, actor } = await setup();
  assert.equal((await s.history(actor, d.id)).valid, true);
  await pool.query('UPDATE lc_events SET body = $1 WHERE tenant = $2 AND document = $3', [JSON.stringify({ previousHash: null, sequence: 1 }), actor.tenant, d.id]);
  assert.equal((await s.history(actor, d.id)).valid, false);
});

test('PostgreSQL audits are source-bound, tenant-isolated and preserve Draft', async () => {
  const { s, d, actor, other } = await setup();
  const audit = await s.saveAudit({ ...actor, role: 'viewer' }, d, validAudit(d));
  assert.equal(audit.sourceHash, sourceHash(d));
  assert.deepEqual(await s.getAudit(actor, d.id, audit.id), audit);
  assert.deepEqual(await s.get(actor, d.id), d);
  await assert.rejects(s.getAudit(other, d.id, audit.id), code('NOT_FOUND'));
  await s.accept(actor, d.id, (await proposal(s, actor, d)).id);
  await assert.rejects(s.saveAudit(actor, d, validAudit(d)), code('REVISION_CONFLICT'));
  await assert.rejects(s.release(actor, d.id, audit.id), code('REVISION_CONFLICT'));
});

test('PostgreSQL release gates reject incomplete reviews, blockers and overflow independently', async () => {
  const { s, d, actor } = await setup();
  for (const alter of [a => { a.semantic.status = 'not_run'; }, a => { a.freshReader.status = 'not_run'; }, a => { a.findings.push({ id: 'b', severity: 'blocker', message: 'Blocked.' }); }, a => { a.compiled.budget.fits = false; }]) {
    const report = validAudit(d); alter(report);
    const audit = await s.saveAudit(actor, d, report);
    await assert.rejects(s.release(actor, d.id, audit.id), code('AUDIT_BLOCKED'));
  }
  assert.equal((await rows('lc_releases', actor, d.id)).length, 0);
});

test('PostgreSQL release enforces publisher, source hash and all warning acknowledgements', async () => {
  const { s, d, actor } = await setup(), report = validAudit(d);
  report.findings = [{ id: 'w1', severity: 'warning', message: 'One risk.' }, { id: 'w2', severity: 'warning', message: 'Another risk.' }];
  const audit = await s.saveAudit(actor, d, report);
  await assert.rejects(s.release({ ...actor, role: 'editor' }, d.id, audit.id, ['w1', 'w2']), code('FORBIDDEN'));
  await assert.rejects(s.release(actor, d.id, audit.id, ['w1']), code('ACKNOWLEDGEMENT'));
  const release = await s.release(actor, d.id, audit.id, ['w1', 'w2']);
  assert.deepEqual(await s.release(actor, d.id, audit.id, ['w1', 'w2']), release);
  assert.equal(release.content, sqliteExportText(audit, true));
  assert.deepEqual(await s.get(actor, d.id), d);
  assert.equal((await rows('lc_releases', actor, d.id)).length, 1);
  audit.sourceHash = '0'.repeat(64);
  await pool.query('UPDATE lc_audits SET body = $1 WHERE tenant = $2 AND id = $3', [JSON.stringify(audit), actor.tenant, audit.id]);
  await assert.rejects(s.release(actor, d.id, audit.id, ['w1', 'w2']), code('STALE_AUDIT'));
});

test('PostgreSQL duplicate simultaneous acceptance commits exactly once', async () => {
  const { s, peer, d, actor } = await setup(), p = await proposal(s, actor, d);
  const accepted = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? peer : s).accept(actor, d.id, p.id)));
  assert.ok(accepted.every(doc => doc.revision === 2));
  assert.equal((await rows('lc_snapshots', actor, d.id)).length, 2);
  assert.equal((await s.history(actor, d.id)).entries.length, 2);
});

test('PostgreSQL competing proposals have one winner and preserve the losing section', async () => {
  const { s, peer, d, actor } = await setup();
  const [a, b] = await Promise.all([proposal(s, actor, d), proposal(peer, actor, d, 'outcome', 'Different outcome.')]);
  const result = await Promise.allSettled([s.accept(actor, d.id, a.id), peer.accept(actor, d.id, b.id)]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(result.find(r => r.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  const next = await s.get(actor, d.id), winner = result[0].status === 'fulfilled' ? 0 : 1;
  assert.equal(next.sections[1 - winner].content, d.sections[1 - winner].content);
  assert.equal((await s.history(actor, d.id)).valid, true);
});

test('PostgreSQL simultaneous audits and publications preserve event sequence and idempotency', async () => {
  const { s, peer, d, actor } = await setup();
  const audits = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? peer : s).saveAudit(actor, d, validAudit(d))));
  let history = await s.history(actor, d.id);
  assert.equal(history.valid, true);
  assert.deepEqual(history.entries.map(e => e.sequence), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const releases = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? peer : s).release(actor, d.id, audits[0].id)));
  assert.ok(releases.every(r => r.id === releases[0].id));
  history = await s.history(actor, d.id);
  assert.equal(history.entries.length, 10);
  assert.equal(history.valid, true);
});

test('PostgreSQL tenant creation lock enforces 200-document limit under competing requests', async () => {
  const { s, peer, actor } = await setup();
  // Seed 198 valid rows in one transaction to focus this test on the limit race.
  // This is fixture setup only; normal creation always writes snapshots/events.
  await transaction(pool, async client => {
    for (let i = 0; i < 198; i++) {
      const doc = template(`Limit fixture ${i}`, ['writing']);
      await client.query('INSERT INTO lc_documents (tenant, id, body, revision) VALUES ($1, $2, $3, $4)', [actor.tenant, doc.id, JSON.stringify(doc), doc.revision]);
    }
  });
  const result = await Promise.allSettled([s.create(actor, input()), peer.create(actor, input())]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(result.find(r => r.status === 'rejected').reason.code, 'LIMIT');
  assert.equal((await s.list(actor)).length, 200);
});

test('PostgreSQL durable actor rate limits are shared between store instances and expire by DB clock', async () => {
  const { s, peer, actor, other } = await setup();
  const result = await Promise.allSettled(Array.from({ length: 31 }, (_, i) => (i % 2 ? peer : s).meter(actor)));
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 30);
  assert.equal(result.find(r => r.status === 'rejected').reason.code, 'RATE_LIMIT');
  await s.meter(other);
  await s.meter({ ...actor, sub: 'bob' });
  await pool.query("UPDATE lc_actor_rates SET window_start = clock_timestamp() - INTERVAL '61 seconds' WHERE tenant = $1 AND actor = $2", [actor.tenant, actor.sub]);
  await s.meter(actor);
});

test('PostgreSQL inference lease blocks concurrent actor work and stale release cannot clear renewal', async () => {
  const { s, peer, actor } = await setup();
  const release = await s.acquireInference(actor);
  await assert.rejects(peer.acquireInference(actor), code('BUSY'));
  await pool.query("UPDATE lc_inference_leases SET expires_at = clock_timestamp() - INTERVAL '1 second' WHERE tenant = $1", [actor.tenant]);
  const nextRelease = await peer.acquireInference(actor);
  await release();
  await assert.rejects(s.acquireInference(actor), code('BUSY'));
  await nextRelease();
  const lastRelease = await s.acquireInference(actor);
  await lastRelease();
  await lastRelease();
});

test('PostgreSQL inference capacity is bounded per tenant with separate actors', async () => {
  const { s, peer, actor, other } = await setup();
  const result = await Promise.allSettled(Array.from({ length: 9 }, (_, i) => (i % 2 ? peer : s).acquireInference({ ...actor, sub: `worker-${i}` })));
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 8);
  assert.equal(result.find(r => r.status === 'rejected').reason.code, 'CAPACITY');
  const otherRelease = await s.acquireInference(other);
  await otherRelease();
  for (const r of result) if (r.status === 'fulfilled') await r.value();
});

test('PostgreSQL injected pools are borrowed; store close does not close another request pool', async () => {
  const s = new NeonStore({ pool });
  await s.close();
  await s.ready();
  let ended = false;
  await new NeonStore({ pool: { connect() {}, query() {}, async end() { ended = true; } }, ownsPool: true }).close();
  assert.equal(ended, true);
});

test('PostgreSQL retains exact source, history and released text across embedded database restart', { skip: realPostgres ? 'Embedded durability check; PostgreSQL restart belongs to deployment acceptance.' : false }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'document-pglite-'));
  let local;
  try {
    local = embeddedPool(await PGlite.create(join(dir, 'db')));
    await migrateNeon(local);
    let s = new NeonStore({ pool: local }), actor = { sub: 'alice', tenant: 'restart-fixture', role: 'admin' };
    const d = await s.create(actor, input()), p = await proposal(s, actor, d), next = await s.accept(actor, d.id, p.id);
    const audit = await s.saveAudit(actor, next, validAudit(next)), release = await s.release(actor, d.id, audit.id), history = await s.history(actor, d.id);
    await local.end(); local = undefined;
    local = embeddedPool(await PGlite.create(join(dir, 'db')));
    s = new NeonStore({ pool: local });
    await s.ready();
    assert.equal(JSON.stringify(await s.get(actor, d.id)), JSON.stringify(next));
    assert.deepEqual(await s.history(actor, d.id), history);
    assert.deepEqual(await s.release(actor, d.id, audit.id), release);
  } finally { await local?.end(); await rm(dir, { recursive: true, force: true }); }
});

test('real PostgreSQL row lock blocks a second transaction until commit', { skip: !realPostgres && 'Requires DOCUMENT_TEST_DATABASE_URL; PGlite cannot prove multi-connection row lock contention.' }, async () => {
  const { s, peer, d, actor } = await setup();
  let entered, resume;
  const inside = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { resume = resolve; });
  const first = s.mutate(actor, d.id, 1, 'first', {}, async next => { entered(); await gate; next.title = 'First lock holder'; });
  await inside;
  let secondFinished = false;
  const second = peer.mutate(actor, d.id, 1, 'second', {}, next => { next.title = 'Second contender'; }).finally(() => { secondFinished = true; });
  const outcome = assert.rejects(second, code('REVISION_CONFLICT'));
  try {
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(secondFinished, false);
  } finally { resume(); }
  await first;
  await outcome;
  assert.equal((await s.get(actor, d.id)).title, 'First lock holder');
});

test('PostgreSQL source/export semantics agree with the untouched SQLite reference', async () => {
  const { s, d, actor } = await setup(), sqlite = new Store();
  try {
    sqlite.create(actor, d);
    const pgAudit = await s.saveAudit(actor, d, validAudit(d));
    const localAudit = sqlite.saveAudit(actor, d, validAudit(d));
    assert.equal(pgAudit.sourceHash, localAudit.sourceHash);
    assert.equal(exportText(pgAudit), sqliteExportText(localAudit));
    assert.equal((await s.release(actor, d.id, pgAudit.id)).content, sqlite.release(actor, d.id, localAudit.id).content);
    assert.equal(JSON.stringify(await s.get(actor, d.id)), JSON.stringify(sqlite.get(actor, d.id)));
  } finally { sqlite.close(); }
});


test('Neon request factory validates configuration and borrowed pool schema without opening network connections', async () => {
  await assert.rejects(createNeonStore({ connectionString: '' }), code('DATABASE_CONFIG'));
  const store = await createNeonStore({ pool });
  assert.equal(store.ownsPool, false);
  await store.close();
  await store.ready();
  const missingSchema = { connect() {}, async query() { const error = new Error('missing table'); error.code = '42P01'; throw error; } };
  await assert.rejects(createNeonStore({ pool: missingSchema }), code('MIGRATION'));
});

test('PostgreSQL transaction rollback failure discards connection but preserves original failure', async () => {
  let releasedWith;
  const failure = new Error('Original operation failure'), rollbackFailure = new Error('Connection disappeared');
  const mockPool = { async connect() { return { async query(sql) { if (sql === 'ROLLBACK') throw rollbackFailure; }, release(error) { releasedWith = error; } }; } };
  await assert.rejects(transaction(mockPool, async () => { throw failure; }), error => error === failure);
  assert.equal(releasedWith, rollbackFailure);
});

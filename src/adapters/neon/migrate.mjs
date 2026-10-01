import { readFile } from 'node:fs/promises';
import { fail } from '../../core/contracts.mjs';
import { transaction } from './transaction.mjs';

export const SCHEMA_VERSION = 1;

/** Explicit operator migration, never run implicitly during an HTTP request. */
export async function migrateNeon(pool) {
  const sql = await readFile(new URL('../../../migrations/001_document.sql', import.meta.url), 'utf8');
  return transaction(pool, async client => {
    // Serializes first-time DDL as well as upgrades across migration processes.
    await client.query('SELECT pg_advisory_xact_lock(1818321753, 1)');
    await client.query(`CREATE TABLE IF NOT EXISTS lc_schema_version (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      version INTEGER NOT NULL CHECK (version >= 0)
    )`);
    await client.query('INSERT INTO lc_schema_version VALUES (1, 0) ON CONFLICT (singleton) DO NOTHING');
    const { rows: [row] } = await client.query('SELECT version FROM lc_schema_version WHERE singleton = 1 FOR UPDATE');
    if (row.version > SCHEMA_VERSION) fail(500, 'MIGRATION', 'Database version is newer than this application.');
    if (row.version === 0) {
      // pg Pool supports multi-statement simple queries with no parameters.
      await client.query(sql);
      await client.query('UPDATE lc_schema_version SET version = $1 WHERE singleton = 1', [SCHEMA_VERSION]);
    }
    return SCHEMA_VERSION;
  });
}

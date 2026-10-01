import { Pool, neonConfig } from '@neondatabase/serverless';
import WebSocket from 'ws';
import { fail } from '../../core/contracts.mjs';
import { NeonStore } from './store.mjs';
export { NeonStore } from './store.mjs';
export { migrateNeon } from './migrate.mjs';

/**
 * Create inside a request handler, close in its finally block. Never share a
 * WebSocket pool across serverless invocations. No database is provisioned.
 */
export async function createNeonStore({ connectionString = process.env.DATABASE_URL, pool, checkSchema = true } = {}) {
  if (!pool && !connectionString) fail(500, 'DATABASE_CONFIG', 'Configure DATABASE_URL for the Neon adapter.');
  if (!pool) neonConfig.webSocketConstructor = WebSocket;
  const store = new NeonStore({ pool: pool ?? new Pool({ connectionString, max: 3, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000 }), ownsPool: !pool });
  try {
    if (checkSchema) await store.ready();
    return store;
  } catch (error) {
    await store.close();
    throw error;
  }
}

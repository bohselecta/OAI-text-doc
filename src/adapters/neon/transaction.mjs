/** One connection for BEGIN, every statement, and COMMIT/ROLLBACK. */
export async function transaction(pool, fn) {
  const client = await pool.connect();
  let begun = false, discard;
  try {
    await client.query('BEGIN');
    begun = true;
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (begun) {
      try { await client.query('ROLLBACK'); }
      catch (rollbackError) { discard = rollbackError; }
    } else { discard = error; }
    throw error;
  } finally {
    client.release(discard);
  }
}

// src/db/db.ts
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";

import * as coreSchema from "./schema";
import * as applianceSchema from "./applianceSchema";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL must be set.");

const combinedSchema = { ...coreSchema, ...applianceSchema };

// The Pool-backed db and the per-request PoolClient-backed tx inside
// withTenantSchema both build the same query surface off this schema --
// the underlying $client (Pool vs PoolClient) differs, but nothing here
// touches $client directly, so a single schema-shaped type covers both.
export type AppDatabase = NodePgDatabase<typeof combinedSchema>;

const globalForDb = globalThis as unknown as {
  __PG_POOL__?: Pool;
  __DRIZZLE_DB__?: AppDatabase;
};

const pool =
  globalForDb.__PG_POOL__ ??
  new Pool({
    connectionString: DATABASE_URL,
    ssl: false,
    max: 10,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
    keepAlive: true,
    allowExitOnIdle: true,
  });

pool.on("error", (err) => {
  console.error("⚠️ Unexpected error on idle Postgres client:", err.message);
});

const db: AppDatabase =
  globalForDb.__DRIZZLE_DB__ ??
  drizzle(pool, { schema: combinedSchema });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__PG_POOL__ = pool;
  globalForDb.__DRIZZLE_DB__ = db;
}

/**
 * Runs `callback` against a DEDICATED connection with search_path locked
 * to `schemaName` for the lifetime of one transaction.
 *
 * SET LOCAL (not plain SET) is load-bearing here: it only lasts until
 * COMMIT/ROLLBACK, so even though the underlying physical connection goes
 * back into the shared pool afterward, nothing about this tenant's schema
 * selection can leak into whichever request picks that connection up next.
 * Plain SET search_path on a pooled connection would NOT auto-revert, and
 * a later request for a different tenant could silently inherit it.
 */
export async function withTenantSchema<T>(
  schemaName: string,
  callback: (tx: AppDatabase) => Promise<T>,
): Promise<T> {
  // Defense in depth: schemaName ultimately comes from a JWT claim or a
  // public.organizations lookup, never raw user input, but this is a
  // template-interpolated identifier going into SQL, so validate the
  // shape regardless of where it came from.
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schemaName)) {
    throw new Error(`Invalid schema name: ${schemaName}`);
  }

  const client = await pool.connect();
  let settled = false;

  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL search_path TO "${schemaName}", public`);

    // Cast: drizzle(client, ...) with a PoolClient produces a structurally
    // identical query surface to drizzle(pool, ...), differing only in the
    // $client field's type, which nothing here relies on.
    const tx = drizzle(client, { schema: combinedSchema }) as AppDatabase;
    const result = await callback(tx);

    await client.query("COMMIT");
    settled = true;
    client.release();
    return result;
  } catch (error) {
    if (settled) {
      // COMMIT itself succeeded and only the release() call after it
      // threw -- nothing left to roll back, and the client may already
      // be gone from the pool's perspective. Just propagate.
      throw error;
    }

    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      // The connection is very likely already dead at this point (e.g.
      // the server/pooler terminated it mid-transaction) -- ROLLBACK
      // itself failing is expected in that case, not a new problem.
      console.error(
        "Rollback failed (connection likely already dead):",
        rollbackError,
      );
    }

    // Release WITH the error so pg discards this connection instead of
    // returning it to the idle pool. This is the load-bearing fix: without
    // it, a connection killed mid-transaction by the server/pooler (e.g.
    // Supabase's Supavisor terminating it) goes back into the pool intact
    // from node-postgres's point of view, and the NEXT request to check it
    // out gets a connection with no search_path set at all -- which looks
    // exactly like "relation X does not exist" rather than a connection
    // error, on a completely unrelated request.
    client.release(error as Error);
    throw error;
  }
}

export { db, pool, applianceSchema, combinedSchema, coreSchema as schema };
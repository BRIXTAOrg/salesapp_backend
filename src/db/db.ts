// src/db/db.ts
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

import * as coreSchema from "./schema";
import * as applianceSchema from "./applianceSchema";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL must be set.");

const combinedSchema = { ...coreSchema, ...applianceSchema };

const globalForDb = globalThis as unknown as {
  __PG_POOL__?: Pool;
  __DRIZZLE_DB__?: ReturnType<typeof drizzle>;
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

const db =
  globalForDb.__DRIZZLE_DB__ ??
  drizzle(pool, { schema: combinedSchema });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__PG_POOL__ = pool;
  globalForDb.__DRIZZLE_DB__ = db;
}

export { db, pool, applianceSchema, combinedSchema, coreSchema as schema };

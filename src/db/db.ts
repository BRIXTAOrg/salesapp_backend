import {
  Pool,
} from "pg";

import {
  drizzle,
  type NodePgDatabase,
} from "drizzle-orm/node-postgres";

import * as coreSchema from "./schema";
import * as applianceSchema from "./applianceSchema";
import * as workflowSchema from "./workflowSchema";
import * as platformVNextSchema from "./platformVNextSchema";

const DATABASE_URL =
  process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set.",
  );
}

const combinedSchema = {
  ...coreSchema,
  ...applianceSchema,
  ...workflowSchema,
  ...platformVNextSchema,
};

export type AppDatabase =
  NodePgDatabase<
    typeof combinedSchema
  >;

const globalForDb =
  globalThis as unknown as {
    __PG_POOL__?: Pool;
    __DRIZZLE_DB__?:
      AppDatabase;
  };

const pool =
  globalForDb.__PG_POOL__ ??
  new Pool({
    connectionString:
      DATABASE_URL,
    ssl: false,
    max: 10,
    idleTimeoutMillis:
      10_000,
    connectionTimeoutMillis:
      5_000,
    statement_timeout:
      10_000,
    keepAlive: true,
    allowExitOnIdle:
      true,
  });

pool.on(
  "error",
  (err) => {
    console.error(
      "⚠️ Unexpected error on idle Postgres client:",
      err.message,
    );
  },
);

const db: AppDatabase =
  globalForDb.__DRIZZLE_DB__ ??
  drizzle(
    pool,
    {
      schema:
        combinedSchema,
    },
  );

if (
  process.env.NODE_ENV !==
  "production"
) {
  globalForDb.__PG_POOL__ =
    pool;
  globalForDb.__DRIZZLE_DB__ =
    db;
}

export async function withTenantSchema<
  T,
>(
  schemaName: string,
  callback: (
    tx: AppDatabase,
  ) => Promise<T>,
): Promise<T> {
  if (
    !/^[a-z][a-z0-9_]{0,62}$/.test(
      schemaName,
    )
  ) {
    throw new Error(
      `Invalid schema name: ${schemaName}`,
    );
  }

  const client =
    await pool.connect();

  let settled = false;

  try {
    await client.query(
      "BEGIN",
    );

    await client.query(
      `SET LOCAL search_path TO "${schemaName}", public`,
    );

    const tx =
      drizzle(
        client,
        {
          schema:
            combinedSchema,
        },
      ) as AppDatabase;

    const result =
      await callback(tx);

    await client.query(
      "COMMIT",
    );

    settled = true;
    client.release();

    return result;
  } catch (error) {
    if (settled) {
      throw error;
    }

    try {
      await client.query(
        "ROLLBACK",
      );
    } catch (
      rollbackError
    ) {
      console.error(
        "Rollback failed (connection likely already dead):",
        rollbackError,
      );
    }

    client.release(
      error as Error,
    );

    throw error;
  }
}

export {
  db,
  pool,
  applianceSchema,
  workflowSchema,
  platformVNextSchema,
  combinedSchema,
  coreSchema as schema,
};

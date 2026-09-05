import {
  createHash,
} from "node:crypto";

import {
  sql,
} from "drizzle-orm";

import type {
  AppDatabase,
} from "../db/db";


function bucketKey(
  scope: string,
  identity: string,
) {
  return createHash(
    "sha256",
  )
    .update(
      `${scope}:${identity}`,
      "utf8",
    )
    .digest(
      "hex",
    );
}


export async function consumePublicRateLimit(
  db: AppDatabase,
  input: {
    scope: string;
    identity: string;
    limit?: number;
    windowSeconds?: number;
  },
) {
  const limit =
    Math.max(
      1,
      Math.min(
        10_000,
        Number(
          input.limit ??
          120,
        ),
      ),
    );

  const windowSeconds =
    Math.max(
      10,
      Math.min(
        86_400,
        Number(
          input.windowSeconds ??
          60,
        ),
      ),
    );

  const now =
    Date.now();

  const windowStart =
    new Date(
      Math.floor(
        now /
        (
          windowSeconds *
          1000
        ),
      ) *
      (
        windowSeconds *
        1000
      ),
    );

  const key =
    bucketKey(
      input.scope,
      input.identity,
    );

  const result =
    await db.execute(sql`
      INSERT INTO
        public_runtime_rate_limits (
          bucket_key,
          window_started_at,
          count,
          updated_at
        )

      VALUES (
        ${key},
        ${windowStart},
        1,
        now()
      )

      ON CONFLICT (
        bucket_key,
        window_started_at
      )
      DO UPDATE
      SET
        count =
          public_runtime_rate_limits.count +
          1,

        updated_at =
          now()

      RETURNING
        count
    `);

  const count =
    Number(
      (
        result.rows[0] as
          | {
              count?: unknown;
            }
          | undefined
      )?.count ??
      0,
    );

  return {
    allowed:
      count <=
      limit,

    count,

    limit,

    windowSeconds,
  };
}

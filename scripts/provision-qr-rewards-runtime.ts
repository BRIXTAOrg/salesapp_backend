import dotenv from "dotenv";
import pg from "pg";


dotenv.config({
  path:
    ".env.local",

  override:
    false,
});

dotenv.config({
  path:
    ".env",

  override:
    false,
});


const schema =
  String(
    process.argv[2] ??
    "",
  ).trim();


if (
  !/^[a-z][a-z0-9_]{0,62}$/.test(
    schema,
  )
) {
  console.error(
    "Usage: npm run qr-rewards:provision -- <tenant_schema>",
  );

  process.exit(1);
}


if (
  !process.env
    .DATABASE_URL
) {
  throw new Error(
    "DATABASE_URL is required.",
  );
}


const pool =
  new pg.Pool({
    connectionString:
      process.env
        .DATABASE_URL,

    ssl:
      false,
  });


const client =
  await pool.connect();


try {
  await client.query(
    "BEGIN",
  );

  await client.query(
    `SET LOCAL search_path TO "${schema}", public`,
  );


  const version =
    await client.query<{
      value:
        string;
    }>(`
      SELECT
        value

      FROM
        qr_rewards_meta

      WHERE
        key =
          'schema_version'

      LIMIT 1
    `);


  const current =
    Number(
      version.rows[0]
        ?.value,
    );


  if (
    current <
    6
  ) {
    throw new Error(
      `Tenant "${schema}" must be on QR Rewards V6 before backend runtime provisioning. Current=${String(current)}`,
    );
  }


  /*
   * Public claimant:
   *
   * user_id = NULL
   *
   * Logged-in BRIXTA app claimant:
   *
   * user_id = actual employee ID
   */
  await client.query(`
    ALTER TABLE
      qr_reward_claims

    ALTER COLUMN
      user_id
      DROP NOT NULL
  `);


  await client.query(`
    ALTER TABLE
      qr_reward_claims

    ADD COLUMN IF NOT EXISTS
      claimant_type
        varchar(32)
  `);


  await client.query(`
    UPDATE
      qr_reward_claims

    SET
      claimant_type =
        'brixta_user'

    WHERE
      claimant_type
        IS NULL
  `);


  await client.query(`
    ALTER TABLE
      qr_reward_claims

    ALTER COLUMN
      claimant_type
      SET DEFAULT
        'brixta_user'
  `);


  await client.query(`
    ALTER TABLE
      qr_reward_claims

    ALTER COLUMN
      claimant_type
      SET NOT NULL
  `);


  await client.query(`
    CREATE TABLE IF NOT EXISTS
      qr_reward_payouts (
        id
          uuid
          PRIMARY KEY,

        claim_id
          uuid
          NOT NULL
          UNIQUE
          REFERENCES
            qr_reward_claims(id)
          ON DELETE
            RESTRICT,

        provider
          varchar(80)
          NOT NULL
          DEFAULT
            'brixta_sandbox',

        amount_minor
          integer
          NOT NULL
          CHECK (
            amount_minor >
            0
          ),

        currency
          varchar(3)
          NOT NULL
          DEFAULT
            'INR',

        beneficiary_type
          varchar(32)
          NOT NULL,

        beneficiary_ciphertext
          text
          NOT NULL,

        beneficiary_key_hash
          varchar(64)
          NOT NULL,

        request_id
          varchar(160)
          NOT NULL
          UNIQUE,

        provider_transfer_ref
          varchar(255),

        status
          varchar(32)
          NOT NULL
          DEFAULT
            'created',

        attempts
          integer
          NOT NULL
          DEFAULT
            0,

        last_error
          text,

        provider_response
          jsonb
          NOT NULL
          DEFAULT
            '{}'::jsonb,

        requested_at
          timestamptz,

        paid_at
          timestamptz,

        created_at
          timestamptz
          NOT NULL
          DEFAULT
            now(),

        updated_at
          timestamptz
          NOT NULL
          DEFAULT
            now()
      )
  `);


  await client.query(`
    CREATE INDEX IF NOT EXISTS
      idx_qr_reward_payouts_status

    ON
      qr_reward_payouts(
        status,
        created_at
      )
  `);


  await client.query(`
    CREATE TABLE IF NOT EXISTS
      integration_service_requests (
        id
          uuid
          PRIMARY KEY,

        capability
          varchar(160)
          NOT NULL,

        request_payload
          jsonb
          NOT NULL
          DEFAULT
            '{}'::jsonb,

        source_metadata
          jsonb
          NOT NULL
          DEFAULT
            '{}'::jsonb,

        idempotency_key
          varchar(220)
          NOT NULL
          UNIQUE,

        status
          varchar(32)
          NOT NULL
          DEFAULT
            'queued',

        attempts
          integer
          NOT NULL
          DEFAULT
            0,

        response_payload
          jsonb,

        last_error
          text,

        next_attempt_at
          timestamptz
          NOT NULL
          DEFAULT
            now(),

        completed_at
          timestamptz,

        created_at
          timestamptz
          NOT NULL
          DEFAULT
            now(),

        updated_at
          timestamptz
          NOT NULL
          DEFAULT
            now()
      )
  `);


  await client.query(`
    CREATE INDEX IF NOT EXISTS
      idx_integration_service_requests_ready

    ON
      integration_service_requests(
        status,
        next_attempt_at,
        created_at
      )
  `);


  await client.query(`
    ALTER TABLE
      qr_reward_payouts

    ADD COLUMN IF NOT EXISTS
      reversed_at
        timestamptz
  `);


  /*
   * Public External Runtime deliberately uses its own record store.
   *
   * It does NOT create fake users and does NOT weaken
   * dynamic_submissions.user_id.
   */
  await client.query(`
    CREATE TABLE IF NOT EXISTS
      external_runtime_records (
        id
          uuid
          PRIMARY KEY,

        responsibility_id
          integer
          NOT NULL,

        responsibility_key
          varchar(180)
          NOT NULL,

        external_session_id
          varchar(80)
          NOT NULL,

        status
          varchar(40)
          NOT NULL
          DEFAULT
            'draft',

        payload
          jsonb
          NOT NULL
          DEFAULT
            '{}'::jsonb,

        manifest_version
          integer,

        manifest_hash
          varchar(128),

        created_at
          timestamptz
          NOT NULL
          DEFAULT
            now(),

        updated_at
          timestamptz
          NOT NULL
          DEFAULT
            now()
      )
  `);


  await client.query(`
    CREATE INDEX IF NOT EXISTS
      idx_external_runtime_records_session

    ON
      external_runtime_records(
        responsibility_id,
        external_session_id,
        updated_at
      )
  `);


  await client.query(`
    CREATE TABLE IF NOT EXISTS
      external_runtime_action_receipts (
        id
          uuid
          PRIMARY KEY,

        responsibility_id
          integer
          NOT NULL,

        external_session_id
          varchar(80)
          NOT NULL,

        client_mutation_id
          varchar(160)
          NOT NULL,

        response_payload
          jsonb
          NOT NULL
          DEFAULT
            '{}'::jsonb,

        created_at
          timestamptz
          NOT NULL
          DEFAULT
            now(),

        updated_at
          timestamptz
          NOT NULL
          DEFAULT
            now(),

        UNIQUE (
          responsibility_id,
          external_session_id,
          client_mutation_id
        )
      )
  `);


  await client.query(`
    CREATE TABLE IF NOT EXISTS
      public_runtime_rate_limits (
        bucket_key
          varchar(64)
          NOT NULL,

        window_started_at
          timestamptz
          NOT NULL,

        count
          integer
          NOT NULL
          DEFAULT
            0,

        updated_at
          timestamptz
          NOT NULL
          DEFAULT
            now(),

        PRIMARY KEY (
          bucket_key,
          window_started_at
        )
      )
  `);


  await client.query(`
    CREATE TABLE IF NOT EXISTS
      integration_webhook_events (
        id
          uuid
          PRIMARY KEY,

        integration_key
          varchar(160)
          NOT NULL,

        event_id
          varchar(255)
          NOT NULL,

        provider_reference
          varchar(255),

        status
          varchar(40),

        payload
          jsonb
          NOT NULL
          DEFAULT
            '{}'::jsonb,

        received_at
          timestamptz
          NOT NULL
          DEFAULT
            now(),

        UNIQUE (
          integration_key,
          event_id
        )
      )
  `);


  await client.query(`
    CREATE INDEX IF NOT EXISTS
      idx_integration_webhook_reference

    ON
      integration_webhook_events(
        provider_reference,
        received_at
      )
  `);


  await client.query(
    `
      INSERT INTO
        platform_meta (
          key,
          value,
          updated_at
        )

      VALUES (
        'qr_rewards_runtime_version',
        $1::jsonb,
        now()
      )

      ON CONFLICT (
        key
      )
      DO UPDATE
      SET
        value =
          EXCLUDED.value,

        updated_at =
          now()
    `,
    [
      JSON.stringify({
        version:
          2,

        publicClaims:
          true,

        payoutIntents:
          true,

        integrationQueue:
          true,

        externalPrincipal:
          true,

        externalActionRuntime:
          true,

        dbRateLimit:
          true,

        webhookRuntime:
          true,

        payoutReconciliation:
          true,
      }),
    ],
  );


  await client.query(
    "COMMIT",
  );


  console.log("");
  console.log("==============================================");
  console.log("BRIXTA QR REWARDS BACKEND RUNTIME V1");
  console.log("==============================================");
  console.log("Tenant:", schema);
  console.log("QR Rewards schema:", current);
  console.log("Public claimants: READY");
  console.log("Payout intents: READY");
  console.log("Integration queue: READY");
  console.log("==============================================");
} catch (
  error
) {
  await client.query(
    "ROLLBACK",
  );

  throw error;
} finally {
  client.release();

  await pool.end();
}

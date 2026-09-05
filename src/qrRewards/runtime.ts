import {
  createHash,
  createHmac,
  randomUUID,
} from "node:crypto";

import {
  sql,
} from "drizzle-orm";

import type {
  AppDatabase,
} from "../db/db";

import {
  pool,
  withTenantSchema,
} from "../db/db";

import {
  decryptSecretBox,
  encryptSecretBox,
  requiredSecret,
} from "../platform/security/secretBox";

import {
  enqueueServiceRequest,
  registerServiceAdapter,
  type ServiceResult,
} from "../platform/integrations/serviceRuntime";

import {
  evaluateRulebook,
  writeRuleEvaluation,
  type RulebookSnapshot,
} from "./rules";


type Voucher = {
  voucherId:
    string;

  serialNumber:
    number;

  voucherStatus:
    string;

  voucherExpiresAt:
    unknown;

  claimedAt:
    unknown | null;

  batchId:
    string;

  batchCode:
    string;

  batchStatus:
    string;

  assignmentId:
    string | null;

  assignmentStatus:
    string | null;

  assignmentExpiresAt:
    unknown | null;

  attributionMode:
    string | null;

  currency:
    string | null;

  campaignId:
    string | null;

  campaignName:
    string | null;

  campaignStatus:
    string | null;

  campaignStartsAt:
    unknown | null;

  campaignExpiresAt:
    unknown | null;

  schemeId:
    string | null;

  schemeName:
    string | null;

  schemeStatus:
    string | null;

  rulebookId:
    string | null;

  rulebookVersion:
    number | null;

  assignmentRulesHash:
    string | null;

  rulebookStatus:
    string | null;

  rulebookRulesHash:
    string | null;

  rewardPolicy:
    unknown;

  claimLimitPolicy:
    unknown;

  fraudPolicy:
    unknown;

  validityPolicy:
    unknown;

  entityTypeId:
    number | null;

  entityTypeName:
    string | null;

  entityRecordId:
    string | null;

  entityLabel:
    string | null;
};


type Entity = {
  entityTypeId:
    number;

  entityTypeName:
    string;

  entityRecordId:
    string;

  entityLabel:
    string;
};


function objectValue(
  value: unknown,
): Record<string, unknown> {
  return (
    value &&
    typeof value ===
      "object" &&
    !Array.isArray(value)
  )
    ? value as
        Record<string, unknown>
    : {};
}


function iso(
  value: unknown,
) {
  if (
    !value
  ) {
    return null;
  }

  const date =
    new Date(
      String(
        value,
      ),
    );

  return Number.isNaN(
    date.getTime(),
  )
    ? null
    : date.toISOString();
}


export function normalizeQrPayload(
  raw: string,
) {
  let value =
    raw.trim();


  try {
    const url =
      new URL(
        value,
      );

    const pieces =
      url.pathname
        .split("/")
        .filter(Boolean);

    const last =
      pieces[
        pieces.length -
        1
      ];

    if (
      last
    ) {
      value =
        decodeURIComponent(
          last,
        );
    }
  } catch {
    // Raw QR token/payload.
  }


  if (
    /^BRX:Q:1:[A-Za-z0-9_-]{43}$/.test(
      value,
    )
  ) {
    return value;
  }


  if (
    /^[A-Za-z0-9_-]{43}$/.test(
      value,
    )
  ) {
    return `BRX:Q:1:${value}`;
  }


  return null;
}


function hashToken(
  payload: string,
) {
  return createHash(
    "sha256",
  )
    .update(
      payload,
      "utf8",
    )
    .digest(
      "hex",
    );
}


function normalizeUpi(
  value: string,
) {
  return value
    .trim()
    .toLowerCase();
}


function validUpi(
  value: string,
) {
  return /^[a-z0-9._-]{2,256}@[a-z][a-z0-9.-]{1,63}$/i.test(
    value,
  );
}


function claimantHash(
  upi: string,
) {
  const secret =
    requiredSecret(
      "BRIXTA_CLAIMANT_HASH_KEY",
      "BRIXTA_INTEGRATION_SECRET_KEY",
    );

  return createHmac(
    "sha256",
    secret,
  )
    .update(
      normalizeUpi(
        upi,
      ),
      "utf8",
    )
    .digest(
      "hex",
    );
}


function piiSecret() {
  return requiredSecret(
    "BRIXTA_PII_SECRET_KEY",
    "BRIXTA_INTEGRATION_SECRET_KEY",
  );
}


async function findVoucher(
  db: AppDatabase,
  tokenHash: string,
  lock = false,
): Promise<
  Voucher | null
> {
  const suffix =
    lock
      ? sql.raw(
          " FOR UPDATE OF v",
        )
      : sql.raw(
          "",
        );


  const result =
    await db.execute(sql`
      SELECT
        v.id
          AS "voucherId",

        v.serial_number
          AS "serialNumber",

        v.status
          AS "voucherStatus",

        v.expires_at
          AS "voucherExpiresAt",

        v.claimed_at
          AS "claimedAt",

        b.id
          AS "batchId",

        b.batch_code
          AS "batchCode",

        b.status
          AS "batchStatus",

        a.id
          AS "assignmentId",

        a.status
          AS "assignmentStatus",

        a.expires_at
          AS "assignmentExpiresAt",

        a.attribution_mode
          AS "attributionMode",

        a.currency,

        c.id
          AS "campaignId",

        c.name
          AS "campaignName",

        c.status
          AS "campaignStatus",

        c.starts_at
          AS "campaignStartsAt",

        c.expires_at
          AS "campaignExpiresAt",

        a.scheme_id
          AS "schemeId",

        s.name
          AS "schemeName",

        s.status
          AS "schemeStatus",

        a.rulebook_id
          AS "rulebookId",

        a.rulebook_version
          AS "rulebookVersion",

        a.rules_hash
          AS "assignmentRulesHash",

        rb.status
          AS "rulebookStatus",

        rb.rules_hash
          AS "rulebookRulesHash",

        rb.reward_policy
          AS "rewardPolicy",

        rb.claim_limit_policy
          AS "claimLimitPolicy",

        rb.fraud_policy
          AS "fraudPolicy",

        rb.validity_policy
          AS "validityPolicy",

        a.entity_type_id
          AS "entityTypeId",

        et.title
          AS "entityTypeName",

        a.entity_record_id
          AS "entityRecordId",

        a.entity_label_snapshot
          AS "entityLabel"

      FROM
        qr_reward_vouchers
          AS v

      INNER JOIN
        qr_reward_batches
          AS b
            ON b.id =
              v.batch_id

      LEFT JOIN
        qr_reward_batch_assignments
          AS a
            ON a.batch_id =
              b.id

            AND
            a.status =
              'active'

      LEFT JOIN
        qr_reward_campaigns
          AS c
            ON c.id =
              a.campaign_id

      LEFT JOIN
        qr_reward_schemes
          AS s
            ON s.id =
              a.scheme_id

      LEFT JOIN
        qr_reward_rulebooks
          AS rb
            ON rb.id =
              a.rulebook_id

      LEFT JOIN
        entity_types
          AS et
            ON et.id =
              a.entity_type_id

      WHERE
        v.token_hash =
          ${tokenHash}

      LIMIT 1

      ${suffix}
    `);


  return (
    result.rows[0] as
      | Voucher
      | undefined
  ) ??
  null;
}


function baseState(
  voucher:
    Voucher,
) {
  if (
    voucher.voucherStatus ===
      "claimed" ||
    voucher.claimedAt
  ) {
    return "already_claimed";
  }


  if (
    voucher.voucherStatus ===
      "revoked" ||
    voucher.batchStatus ===
      "revoked"
  ) {
    return "revoked";
  }


  if (
    !voucher.assignmentId ||
    voucher.assignmentStatus !==
      "active" ||
    !voucher.campaignId
  ) {
    return "unavailable";
  }


  if (
    ![
      "ready",
      "partially_printed",
      "printed",
    ].includes(
      voucher.batchStatus,
    )
  ) {
    return "unavailable";
  }


  if (
    voucher.campaignStatus !==
      "active" ||
    voucher.schemeStatus !==
      "active" ||
    voucher.rulebookStatus !==
      "published"
  ) {
    return "unavailable";
  }


  const now =
    Date.now();

  const start =
    new Date(
      String(
        voucher.campaignStartsAt,
      ),
    ).getTime();


  if (
    Number.isFinite(
      start,
    ) &&
    start >
      now
  ) {
    return "not_started";
  }


  const expiries =
    [
      voucher.voucherExpiresAt,
      voucher.assignmentExpiresAt,
      voucher.campaignExpiresAt,
    ]
      .map(
        (value) =>
          new Date(
            String(
              value,
            ),
          ).getTime(),
      )
      .filter(
        Number.isFinite,
      );


  if (
    expiries.some(
      (value) =>
        value <=
        now,
    )
  ) {
    /*
     * Do NOT permanently set unclaimed voucher to expired.
     * Physical unclaimed QRs are reusable under new assignments.
     */
    return "expired";
  }


  return null;
}


function frozenRulebook(
  voucher:
    Voucher,
): RulebookSnapshot | null {
  if (
    !voucher.schemeId ||
    !voucher.schemeName ||
    !voucher.rulebookId ||
    !voucher.rulebookVersion ||
    !voucher.assignmentRulesHash ||
    !voucher.rulebookRulesHash
  ) {
    return null;
  }


  if (
    voucher.assignmentRulesHash !==
    voucher.rulebookRulesHash
  ) {
    return null;
  }


  return {
    schemeId:
      voucher.schemeId,

    schemeName:
      voucher.schemeName,

    rulebookId:
      voucher.rulebookId,

    rulebookVersion:
      Number(
        voucher.rulebookVersion,
      ),

    rulesHash:
      voucher.assignmentRulesHash,

    rewardPolicy:
      objectValue(
        voucher.rewardPolicy,
      ),

    claimLimitPolicy:
      objectValue(
        voucher.claimLimitPolicy,
      ),

    fraudPolicy:
      objectValue(
        voucher.fraudPolicy,
      ),

    validityPolicy:
      objectValue(
        voucher.validityPolicy,
      ),
  };
}


async function campaignEntities(
  db: AppDatabase,
  campaignId: string,
) {
  const result =
    await db.execute(sql`
      SELECT
        er.id,

        et.id
          AS "entityTypeId",

        et.title
          AS "entityTypeName",

        COALESCE(
          NULLIF(
            er.data ->> 'name',
            ''
          ),

          NULLIF(
            er.data ->> 'title',
            ''
          ),

          er.external_key,

          er.id::text
        )
          AS label

      FROM
        qr_reward_campaign_entities
          AS link

      INNER JOIN
        entity_records
          AS er
            ON er.id =
              link.entity_record_id

      INNER JOIN
        entity_types
          AS et
            ON et.id =
              link.entity_type_id

      WHERE
        link.campaign_id =
          ${campaignId}::uuid

        AND
        er.status =
          'active'

        AND
        et.is_active =
          true

      ORDER BY
        label

      LIMIT 200
    `);


  return result.rows.map(
    (raw) => {
      const row =
        raw as
          Record<string, unknown>;

      return {
        id:
          String(
            row.id,
          ),

        entityTypeId:
          Number(
            row.entityTypeId,
          ),

        entityTypeName:
          String(
            row.entityTypeName,
          ),

        label:
          String(
            row.label,
          ),
      };
    },
  );
}


async function resolveEntity(
  db: AppDatabase,
  voucher:
    Voucher,
  requestedId?:
    string | null,
): Promise<
  | {
      entity:
        Entity | null;
    }
  | {
      error:
        | "entity_required"
        | "entity_invalid";
    }
> {
  const mode =
    voucher.attributionMode ??
    "none";


  if (
    mode ===
    "none"
  ) {
    return {
      entity:
        null,
    };
  }


  if (
    mode ===
    "fixed_entity"
  ) {
    if (
      !voucher.entityTypeId ||
      !voucher.entityTypeName ||
      !voucher.entityRecordId ||
      !voucher.entityLabel
    ) {
      return {
        error:
          "entity_invalid",
      };
    }


    return {
      entity: {
        entityTypeId:
          Number(
            voucher.entityTypeId,
          ),

        entityTypeName:
          voucher.entityTypeName,

        entityRecordId:
          voucher.entityRecordId,

        entityLabel:
          voucher.entityLabel,
      },
    };
  }


  const id =
    String(
      requestedId ??
      "",
    ).trim();


  if (
    !id ||
    !voucher.campaignId
  ) {
    return {
      error:
        id
          ? "entity_invalid"
          : "entity_required",
    };
  }


  const entities =
    await campaignEntities(
      db,
      voucher.campaignId,
    );


  const selected =
    entities.find(
      (entity) =>
        entity.id ===
        id,
    );


  if (
    !selected
  ) {
    return {
      error:
        "entity_invalid",
    };
  }


  return {
    entity: {
      entityTypeId:
        selected.entityTypeId,

      entityTypeName:
        selected.entityTypeName,

      entityRecordId:
        selected.id,

      entityLabel:
        selected.label,
    },
  };
}


async function historicalClaim(
  db: AppDatabase,
  voucherId: string,
) {
  const result =
    await db.execute(sql`
      SELECT
        claim.id
          AS "claimId",

        claim.voucher_id
          AS "voucherId",

        claim.claimed_at
          AS "claimedAt",

        claim.reward_amount_minor_snapshot
          AS "rewardAmountMinor",

        claim.currency_snapshot
          AS currency,

        payout.id
          AS "payoutId",

        payout.status
          AS "payoutStatus",

        payout.provider
          AS "payoutProvider"

      FROM
        qr_reward_claims
          AS claim

      LEFT JOIN
        qr_reward_payouts
          AS payout
            ON payout.claim_id =
              claim.id

      WHERE
        claim.voucher_id =
          ${voucherId}::uuid

      LIMIT 1
    `);


  return (
    result.rows[0] as
      | Record<string, unknown>
      | undefined
  ) ??
  null;
}


async function claimByRequest(
  db: AppDatabase,
  requestId: string,
) {
  const result =
    await db.execute(sql`
      SELECT
        id,

        voucher_id
          AS "voucherId"

      FROM
        qr_reward_claims

      WHERE
        request_id =
          ${requestId}

      LIMIT 1
    `);


  return (
    result.rows[0] as
      | {
          id:
            string;

          voucherId:
            string;
        }
      | undefined
  ) ??
  null;
}


export async function resolveQrReward(
  db: AppDatabase,
  rawToken: string,
  requestedEntityId?:
    string | null,
) {
  const payload =
    normalizeQrPayload(
      rawToken,
    );


  if (
    !payload
  ) {
    return {
      outcome:
        "invalid",
    };
  }


  const voucher =
    await findVoucher(
      db,
      hashToken(
        payload,
      ),
    );


  if (
    !voucher
  ) {
    return {
      outcome:
        "invalid",
    };
  }


  const state =
    baseState(
      voucher,
    );


  if (
    state
  ) {
    return {
      outcome:
        state,

      campaignName:
        voucher.campaignName,

      claim:
        state ===
        "already_claimed"
          ? await historicalClaim(
              db,
              voucher.voucherId,
            )
          : null,
    };
  }


  const rulebook =
    frozenRulebook(
      voucher,
    );


  if (
    !rulebook
  ) {
    return {
      outcome:
        "policy_unavailable",
    };
  }


  if (
    voucher.attributionMode ===
      "claimant_selects" &&
    !requestedEntityId
  ) {
    return {
      outcome:
        "ready",

      campaignName:
        voucher.campaignName,

      schemeName:
        voucher.schemeName,

      rulebookVersion:
        voucher.rulebookVersion,

      rulesHash:
        voucher.assignmentRulesHash,

      attributionMode:
        voucher.attributionMode,

      entities:
        await campaignEntities(
          db,
          voucher.campaignId!,
        ),

      rewardAmountMinor:
        null,

      rewardMode:
        "calculated_after_entity_selection",

      currency:
        voucher.currency,

      expiresAt:
        iso(
          voucher.assignmentExpiresAt,
        ),
    };
  }


  const entityResult =
    await resolveEntity(
      db,
      voucher,
      requestedEntityId,
    );


  if (
    "error" in
    entityResult
  ) {
    return {
      outcome:
        entityResult.error,
    };
  }


  const entity =
    entityResult.entity;


  const evaluation =
    await evaluateRulebook(
      db,
      {
        phase:
          "preflight",

        rulebook,

        context: {
          voucherId:
            voucher.voucherId,

          assignmentId:
            voucher.assignmentId!,

          campaignId:
            voucher.campaignId!,

          entityTypeId:
            entity
              ?.entityTypeId ??
            null,

          entityRecordId:
            entity
              ?.entityRecordId ??
            null,
        },
      },
    );


  if (
    evaluation.decision ===
    "fail"
  ) {
    return {
      outcome:
        "not_eligible",

      reasons:
        evaluation.reasonCodes,
    };
  }


  return {
    outcome:
      "ready",

    campaignName:
      voucher.campaignName,

    schemeName:
      voucher.schemeName,

    rulebookVersion:
      voucher.rulebookVersion,

    rulesHash:
      voucher.assignmentRulesHash,

    attributionMode:
      voucher.attributionMode,

    entity,

    rewardAmountMinor:
      evaluation.rewardAmountMinor,

    rewardMode:
      "known",

    currency:
      voucher.currency,

    expiresAt:
      iso(
        voucher.assignmentExpiresAt,
      ),
  };
}


export async function claimQrReward(
  db: AppDatabase,
  input: {
    rawToken:
      string;

    requestId:
      string;

    upi:
      string;

    /*
     * BRIXTA app user:
     *   userId set.
     *
     * Public camera/browser:
     *   NULL.
     */
    userId?:
      number | null;

    entityRecordId?:
      string | null;
  },
) {
  const payload =
    normalizeQrPayload(
      input.rawToken,
    );


  if (
    !payload
  ) {
    return {
      outcome:
        "invalid",
    };
  }


  const requestId =
    input.requestId
      .trim();


  if (
    requestId.length <
      8 ||
    requestId.length >
      160
  ) {
    return {
      outcome:
        "request_conflict",
    };
  }


  const upi =
    normalizeUpi(
      input.upi,
    );


  if (
    !validUpi(
      upi,
    )
  ) {
    return {
      outcome:
        "invalid_upi",
    };
  }


  const tokenHash =
    hashToken(
      payload,
    );


  const preliminary =
    await findVoucher(
      db,
      tokenHash,
    );


  if (
    !preliminary
  ) {
    return {
      outcome:
        "invalid",
    };
  }


  const claimantKeyHash =
    claimantHash(
      upi,
    );


  /*
   * SAME assignment advisory lock convention used by CMS.
   */
  const locks = [
    `brixta:qr-request:${requestId}`,

    `brixta:qr-batch-assignment:${preliminary.batchId}`,

    `brixta:qr-claimant:${claimantKeyHash}`,
  ];


  for (
    const key of
    locks
  ) {
    await db.execute(sql`
      SELECT
        pg_advisory_xact_lock(
          hashtextextended(
            ${key},
            0
          )
        )
    `);
  }


  const previousRequest =
    await claimByRequest(
      db,
      requestId,
    );


  if (
    previousRequest
  ) {
    if (
      previousRequest.voucherId !==
      preliminary.voucherId
    ) {
      return {
        outcome:
          "request_conflict",
      };
    }


    return {
      outcome:
        "claimed",

      idempotent:
        true,

      claim:
        await historicalClaim(
          db,
          preliminary.voucherId,
        ),
    };
  }


  /*
   * Re-resolve AFTER assignment lock, then lock voucher.
   */
  const voucher =
    await findVoucher(
      db,
      tokenHash,
      true,
    );


  if (
    !voucher
  ) {
    return {
      outcome:
        "invalid",
    };
  }


  const state =
    baseState(
      voucher,
    );


  if (
    state
  ) {
    return {
      outcome:
        state,

      claim:
        state ===
        "already_claimed"
          ? await historicalClaim(
              db,
              voucher.voucherId,
            )
          : null,
    };
  }


  const entityResult =
    await resolveEntity(
      db,
      voucher,
      input.entityRecordId,
    );


  if (
    "error" in
    entityResult
  ) {
    return {
      outcome:
        entityResult.error,
    };
  }


  const entity =
    entityResult.entity;


  if (
    entity
      ?.entityRecordId
  ) {
    await db.execute(sql`
      SELECT
        pg_advisory_xact_lock(
          hashtextextended(
            ${
              `brixta:qr-entity:${entity.entityRecordId}`
            },
            0
          )
        )
    `);
  }


  const rulebook =
    frozenRulebook(
      voucher,
    );


  if (
    !rulebook
  ) {
    return {
      outcome:
        "policy_unavailable",
    };
  }


  const numericUserId =
    Number(
      input.userId,
    );


  const userId =
    Number.isInteger(
      numericUserId,
    ) &&
    numericUserId >
      0
      ? numericUserId
      : null;


  const gate =
    await evaluateRulebook(
      db,
      {
        phase:
          "claim_gate",

        rulebook,

        context: {
          voucherId:
            voucher.voucherId,

          assignmentId:
            voucher.assignmentId!,

          campaignId:
            voucher.campaignId!,

          claimantKeyHash,

          userId,

          entityTypeId:
            entity
              ?.entityTypeId ??
            null,

          entityRecordId:
            entity
              ?.entityRecordId ??
            null,
        },
      },
    );


  if (
    gate.decision ===
    "fail"
  ) {
    await writeRuleEvaluation(
      db,
      {
        voucherId:
          voucher.voucherId,

        assignmentId:
          voucher.assignmentId,

        rulebook,

        phase:
          "claim_gate",

        decision:
          "fail",

        reasonCodes:
          gate.reasonCodes,

        facts: {
          claimantKeyHash,

          userId,

          entityRecordId:
            entity
              ?.entityRecordId ??
            null,
        },
      },
    );


    return {
      outcome:
        "not_eligible",

      reasons:
        gate.reasonCodes,
    };
  }


  const rewardAmountMinor =
    Number(
      gate.rewardAmountMinor,
    );


  if (
    !Number.isInteger(
      rewardAmountMinor,
    ) ||
    rewardAmountMinor <=
      0
  ) {
    return {
      outcome:
        "policy_unavailable",
    };
  }


  const winner =
    await db.execute(sql`
      UPDATE
        qr_reward_vouchers

      SET
        status =
          'claimed',

        claimed_by_user_id =
          ${userId},

        claimed_at =
          now()

      WHERE
        id =
          ${voucher.voucherId}::uuid

        AND
        status =
          'available'

        AND
        claimed_at
          IS NULL

      RETURNING
        claimed_at
          AS "claimedAt"
    `);


  const winnerRow =
    winner.rows[0] as
      | {
          claimedAt?: unknown;
        }
      | undefined;


  if (
    !winnerRow
  ) {
    return {
      outcome:
        "already_claimed",

      claim:
        await historicalClaim(
          db,
          voucher.voucherId,
        ),
    };
  }


  const claimId =
    randomUUID();

  const claimedAt =
    iso(
      winnerRow.claimedAt,
    ) ??
    new Date()
      .toISOString();


  await db.execute(sql`
    INSERT INTO
      qr_reward_claims (
        id,
        voucher_id,
        user_id,
        claimant_type,
        claimant_key_hash,
        request_id,

        assignment_id,

        campaign_id_snapshot,
        reward_amount_minor_snapshot,
        currency_snapshot,

        scheme_id_snapshot,
        scheme_name_snapshot,

        rulebook_id_snapshot,
        rulebook_version_snapshot,
        rules_hash_snapshot,

        entity_type_id_snapshot,
        entity_record_id_snapshot,
        entity_type_label_snapshot,
        entity_label_snapshot,

        claimed_at
      )

    VALUES (
      ${claimId}::uuid,

      ${voucher.voucherId}::uuid,

      ${userId},

      ${
        userId
          ? "brixta_user_upi"
          : "public_upi"
      },

      ${claimantKeyHash},

      ${requestId},

      ${voucher.assignmentId}::uuid,

      ${voucher.campaignId}::uuid,

      ${rewardAmountMinor},

      ${voucher.currency},

      ${rulebook.schemeId}::uuid,

      ${rulebook.schemeName},

      ${rulebook.rulebookId}::uuid,

      ${rulebook.rulebookVersion},

      ${rulebook.rulesHash},

      ${
        entity
          ?.entityTypeId ??
        null
      },

      ${
        entity
          ?.entityRecordId ??
        null
      }::uuid,

      ${
        entity
          ?.entityTypeName ??
        null
      },

      ${
        entity
          ?.entityLabel ??
        null
      },

      ${claimedAt}
    )
  `);


  await writeRuleEvaluation(
    db,
    {
      voucherId:
        voucher.voucherId,

      assignmentId:
        voucher.assignmentId,

      claimId,

      rulebook,

      phase:
        "claim_gate",

      decision:
        "pass",

      reasonCodes:
        [],

      facts: {
        claimantKeyHash,

        userId,

        rewardAmountMinor,

        entityRecordId:
          entity
            ?.entityRecordId ??
        null,
      },
    },
  );


  /*
   * Claim = permanent entitlement.
   *
   * Payout failure must NEVER reopen voucher.
   */
  const payoutId =
    randomUUID();

  const payoutRequestId =
    `payout:${claimId}`;

  const encryptedUpi =
    encryptSecretBox(
      upi,
      piiSecret(),
    );


  await db.execute(sql`
    INSERT INTO
      qr_reward_payouts (
        id,
        claim_id,
        provider,
        amount_minor,
        currency,

        beneficiary_type,
        beneficiary_ciphertext,
        beneficiary_key_hash,

        request_id,

        status,
        attempts,

        created_at,
        updated_at
      )

    VALUES (
      ${payoutId}::uuid,

      ${claimId}::uuid,

      'brixta_sandbox',

      ${rewardAmountMinor},

      ${voucher.currency},

      'upi',

      ${encryptedUpi},

      ${claimantKeyHash},

      ${payoutRequestId},

      'created',

      0,

      now(),
      now()
    )
  `);


  const queued =
    await enqueueServiceRequest(
      db,
      {
        capability:
          "payout.request",

        /*
         * Pixel/public clients never provide authoritative amount.
         *
         * Queue receives claimId only.
         */
        request: {
          claimId,
        },

        idempotencyKey:
          payoutRequestId,

        source: {
          type:
            "qr_reward_claim",

          claimId,

          voucherId:
            voucher.voucherId,
        },
      },
    );


  return {
    outcome:
      "claimed",

    claim: {
      claimId,

      voucherId:
        voucher.voucherId,

      claimedAt,

      claimantType:
        userId
          ? "brixta_user_upi"
          : "public_upi",

      campaignName:
        voucher.campaignName,

      schemeName:
        rulebook.schemeName,

      rulebookVersion:
        rulebook.rulebookVersion,

      rulesHash:
        rulebook.rulesHash,

      rewardAmountMinor,

      currency:
        voucher.currency,

      entity,
    },

    payout: {
      payoutId,

      status:
        "created",

      serviceRequestId:
        queued.id,
    },
  };
}


export async function readQrRewardStatus(
  db: AppDatabase,
  rawToken: string,
) {
  const payload =
    normalizeQrPayload(
      rawToken,
    );


  if (
    !payload
  ) {
    return {
      outcome:
        "invalid",
    };
  }


  const voucher =
    await findVoucher(
      db,
      hashToken(
        payload,
      ),
    );


  if (
    !voucher
  ) {
    return {
      outcome:
        "invalid",
    };
  }


  const claim =
    await historicalClaim(
      db,
      voucher.voucherId,
    );


  return {
    outcome:
      claim
        ? "claimed"
        : (
            baseState(
              voucher,
            ) ??
            "ready"
          ),

    claim,
  };
}


export function registerQrRewardServiceAdapters() {
  registerServiceAdapter(
    "payout.request",
    {
      /*
       * Default:
       *   BRIXTA Sandbox.
       *
       * Switch:
       *   BRIXTA_PAYOUT_PROVIDER=integration
       *
       * Then payout.request MUST have a published API
       * Integration binding.
       */
      preferInternal:
        () =>
          process.env
            .BRIXTA_PAYOUT_PROVIDER !==
          "integration",

      /*
       * A transfer-create timeout/5xx is UNKNOWN, not automatically failed.
       * Reconcile by deterministic status lookup instead of paying twice.
       */
      reconcileOnAmbiguous:
        true,

      prepareInput:
        async (
          db,
          raw,
        ) => {
          const input =
            objectValue(
              raw,
            );

          const claimId =
            String(
              input.claimId ??
              "",
            ).trim();


          if (
            !claimId
          ) {
            throw new Error(
              "payout.request requires claimId.",
            );
          }


          const result =
            await db.execute(sql`
              SELECT
                payout.id
                  AS "payoutId",

                payout.claim_id
                  AS "claimId",

                payout.request_id
                  AS "requestId",

                payout.amount_minor
                  AS "amountMinor",

                payout.currency,

                payout.beneficiary_type
                  AS "beneficiaryType",

                payout.beneficiary_ciphertext
                  AS "beneficiaryCiphertext"

              FROM
                qr_reward_payouts
                  AS payout

              WHERE
                payout.claim_id =
                  ${claimId}::uuid

              LIMIT 1
            `);


          const row =
            result.rows[0] as
              | Record<string, unknown>
              | undefined;


          if (
            !row
          ) {
            throw new Error(
              "Payout intent not found.",
            );
          }


          const amountMinor =
            Number(
              row.amountMinor,
            );

          const beneficiary =
            decryptSecretBox(
              String(
                row.beneficiaryCiphertext,
              ),
              piiSecret(),
            );


          return {
            payoutId:
              String(
                row.payoutId,
              ),

            claimId:
              String(
                row.claimId,
              ),

            requestId:
              String(
                row.requestId,
              ),

            amountMinor,

            amount:
              amountMinor /
              100,

            currency:
              String(
                row.currency,
              ),

            beneficiary: {
              type:
                String(
                  row.beneficiaryType,
                ),

              upi:
                beneficiary,
            },
          };
        },

      executeInternal:
        async (
          db,
          raw,
          idempotencyKey,
        ) => {
          const input =
            objectValue(
              raw,
            );

          const payoutId =
            String(
              input.payoutId ??
              "",
            );


          const providerReference =
            `sandbox_${createHash(
              "sha256",
            )
              .update(
                idempotencyKey,
              )
              .digest("hex")
              .slice(
                0,
                24,
              )}`;


          await db.execute(sql`
            UPDATE
              qr_reward_payouts

            SET
              provider =
                'brixta_sandbox',

              provider_transfer_ref =
                ${providerReference},

              status =
                'paid',

              attempts =
                attempts +
                1,

              provider_response =
                ${JSON.stringify({
                  sandbox:
                    true,

                  status:
                    "paid",

                  providerReference,
                })}::jsonb,

              paid_at =
                now(),

              last_error =
                NULL,

              updated_at =
                now()

            WHERE
              id =
                ${payoutId}::uuid
          `);


          return {
            ok:
              true,

            capability:
              "payout.request",

            provider:
              "brixta_sandbox",

            httpStatus:
              200,

            data: {
              sandbox:
                true,

              status:
                "paid",

              providerReference,
            },

            mapped: {
              status:
                "paid",

              providerTransferRef:
                providerReference,
            },
          };
        },

      applyResult:
        async (
          db,
          raw,
          result:
            ServiceResult,
        ) => {
          const input =
            objectValue(
              raw,
            );

          const payoutId =
            String(
              input.payoutId ??
              "",
            );

          const mapped =
            objectValue(
              result.mapped,
            );

          const rawStatus =
            String(
              mapped.status ??
              "",
            )
              .trim()
              .toLowerCase();


          const paid =
            [
              "paid",
              "success",
              "successful",
              "completed",
            ].includes(
              rawStatus,
            );


          const failed =
            [
              "failed",
              "failure",
              "rejected",
              "cancelled",
              "canceled",
            ].includes(
              rawStatus,
            );


          const status =
            paid
              ? "paid"
              : failed
                ? "failed"
                : "processing";


          const providerReference =
            String(
              mapped.providerTransferRef ??
              mapped.transferId ??
              mapped.reference ??
              "",
            ).trim() ||
            null;


          await db.execute(sql`
            UPDATE
              qr_reward_payouts

            SET
              provider =
                ${result.provider},

              provider_transfer_ref =
                ${providerReference},

              status =
                ${status},

              attempts =
                attempts +
                1,

              provider_response =
                ${JSON.stringify(
                  result,
                )}::jsonb,

              paid_at =
                ${
                  paid
                    ? new Date()
                    : null
                },

              last_error =
                NULL,

              updated_at =
                now()

            WHERE
              id =
                ${payoutId}::uuid
          `);
        },

      applyError:
        async (
          db,
          raw,
          error,
          terminal,
        ) => {
          const input =
            objectValue(
              raw,
            );

          const claimId =
            String(
              input.claimId ??
              "",
            );


          if (
            !claimId
          ) {
            return;
          }


          await db.execute(sql`
            UPDATE
              qr_reward_payouts

            SET
              status =
                ${
                  terminal
                    ? "failed"
                    : "processing"
                },

              last_error =
                ${error.message.slice(
                  0,
                  4000,
                )},

              updated_at =
                now()

            WHERE
              claim_id =
                ${claimId}::uuid
          `);
        },
    },
  );


  registerServiceAdapter(
    "upi.validate",
    {
      preferInternal:
        () =>
          true,

      executeInternal:
        async (
          _db,
          raw,
        ) => {
          const input =
            objectValue(
              raw,
            );

          const upi =
            normalizeUpi(
              String(
                input.upi ??
                "",
              ),
            );

          const valid =
            validUpi(
              upi,
            );

          return {
            ok:
              true,

            capability:
              "upi.validate",

            provider:
              "brixta",

            httpStatus:
              200,

            data: {
              valid,

              normalized:
                valid
                  ? upi
                  : null,

              /*
               * Syntax validity is NOT proof of ownership.
               */
              ownershipVerified:
                false,
            },

            mapped: {
              valid,
            },
          };
        },
    },
  );


  registerServiceAdapter(
    "payout.getStatus",
    {
      prepareInput:
        async (
          db,
          raw,
        ) => {
          const input =
            objectValue(
              raw,
            );

          const claimId =
            String(
              input.claimId ??
              "",
            ).trim();

          const payoutId =
            String(
              input.payoutId ??
              "",
            ).trim();

          if (
            !claimId &&
            !payoutId
          ) {
            throw new Error(
              "payout.getStatus requires claimId or payoutId.",
            );
          }

          const result =
            claimId
              ? await db.execute(sql`
                  SELECT
                    id
                      AS "payoutId",

                    claim_id
                      AS "claimId",

                    request_id
                      AS "requestId",

                    provider,

                    provider_transfer_ref
                      AS "providerTransferRef",

                    status

                  FROM
                    qr_reward_payouts

                  WHERE
                    claim_id =
                      ${claimId}::uuid

                  LIMIT 1
                `)
              : await db.execute(sql`
                  SELECT
                    id
                      AS "payoutId",

                    claim_id
                      AS "claimId",

                    request_id
                      AS "requestId",

                    provider,

                    provider_transfer_ref
                      AS "providerTransferRef",

                    status

                  FROM
                    qr_reward_payouts

                  WHERE
                    id =
                      ${payoutId}::uuid

                  LIMIT 1
                `);

          const row =
            result.rows[0] as
              | Record<string, unknown>
              | undefined;

          if (!row) {
            throw new Error(
              "Payout intent not found.",
            );
          }

          return {
            payoutId:
              String(
                row.payoutId,
              ),

            claimId:
              String(
                row.claimId,
              ),

            requestId:
              String(
                row.requestId,
              ),

            provider:
              String(
                row.provider,
              ),

            providerTransferRef:
              row.providerTransferRef
                ? String(
                    row.providerTransferRef,
                  )
                : null,

            currentStatus:
              String(
                row.status,
              ),

            pathParams: {
              transferId:
                row.providerTransferRef
                  ? String(
                      row.providerTransferRef,
                    )
                  : String(
                      row.requestId,
                    ),
            },
          };
        },

      preferInternal:
        () =>
          process.env
            .BRIXTA_PAYOUT_PROVIDER !==
          "integration",

      executeInternal:
        async (
          _db,
          raw,
        ) => {
          const input =
            objectValue(
              raw,
            );

          const status =
            String(
              input.currentStatus ??
              "processing",
            );

          return {
            ok:
              true,

            capability:
              "payout.getStatus",

            provider:
              String(
                input.provider ??
                "brixta_sandbox",
              ),

            httpStatus:
              200,

            data: {
              status,

              providerTransferRef:
                input
                  .providerTransferRef ??
                null,
            },

            mapped: {
              status,

              providerTransferRef:
                input
                  .providerTransferRef ??
                null,
            },
          };
        },

      applyResult:
        async (
          db,
          raw,
          result,
        ) => {
          const input =
            objectValue(
              raw,
            );

          const mapped =
            objectValue(
              result.mapped,
            );

          const rawStatus =
            String(
              mapped.status ??
              "",
            )
              .trim()
              .toLowerCase();

          const status =
            [
              "paid",
              "success",
              "successful",
              "completed",
            ].includes(
              rawStatus,
            )
              ? "paid"
              : [
                  "failed",
                  "failure",
                  "rejected",
                  "cancelled",
                  "canceled",
                ].includes(
                  rawStatus,
                )
                ? "failed"
                : [
                    "reversed",
                    "reverse",
                  ].includes(
                    rawStatus,
                  )
                  ? "reversed"
                  : "processing";

          const reference =
            String(
              mapped
                .providerTransferRef ??
              mapped.transferId ??
              mapped.reference ??
              input
                .providerTransferRef ??
              "",
            ).trim() ||
            null;

          await db.execute(sql`
            UPDATE
              qr_reward_payouts

            SET
              status =
                ${status},

              provider =
                ${result.provider},

              provider_transfer_ref =
                COALESCE(
                  ${reference},
                  provider_transfer_ref
                ),

              provider_response =
                ${JSON.stringify(
                  result,
                )}::jsonb,

              paid_at =
                CASE
                  WHEN ${status} = 'paid'
                  THEN COALESCE(
                    paid_at,
                    now()
                  )
                  ELSE paid_at
                END,

              reversed_at =
                CASE
                  WHEN ${status} = 'reversed'
                  THEN COALESCE(
                    reversed_at,
                    now()
                  )
                  ELSE reversed_at
                END,

              last_error =
                NULL,

              updated_at =
                now()

            WHERE
              id =
                ${String(
                  input.payoutId ??
                  "",
                )}::uuid
          `);
        },
    },
  );
}



let payoutReconcilerStarted =
  false;

let payoutReconcilerBusy =
  false;


async function payoutSchemas() {
  const result =
    await pool.query<{
      schema: string;
    }>(`
      SELECT DISTINCT
        table_schema
          AS schema

      FROM
        information_schema.tables

      WHERE
        table_name =
          'qr_reward_payouts'

        AND
        table_schema NOT IN (
          'pg_catalog',
          'information_schema'
        )

      ORDER BY
        table_schema
    `);

  return result.rows
    .map(
      (row) =>
        row.schema,
    )
    .filter(
      (schema) =>
        /^[a-z][a-z0-9_]{0,62}$/.test(
          schema,
        ),
    );
}


async function payoutReconcileTick() {
  if (
    payoutReconcilerBusy
  ) {
    return;
  }

  payoutReconcilerBusy =
    true;

  try {
    const schemas =
      await payoutSchemas();

    for (
      const schema of
      schemas
    ) {
      await withTenantSchema(
        schema,
        async (
          db,
        ) => {
          const result =
            await db.execute(sql`
              SELECT
                id,
                claim_id
                  AS "claimId"

              FROM
                qr_reward_payouts

              WHERE
                status IN (
                  'processing',
                  'uncertain'
                )

                AND
                updated_at <=
                  now() -
                  interval '15 seconds'

              ORDER BY
                updated_at

              LIMIT 50
            `);

          const minute =
            Math.floor(
              Date.now() /
              60_000,
            );

          for (
            const raw of
            result.rows
          ) {
            const row =
              raw as
                Record<string, unknown>;

            await enqueueServiceRequest(
              db,
              {
                capability:
                  "payout.getStatus",

                request: {
                  payoutId:
                    String(
                      row.id,
                    ),

                  claimId:
                    String(
                      row.claimId,
                    ),
                },

                idempotencyKey:
                  `payout-status:${String(row.id)}:${minute}`,

                source: {
                  type:
                    "payout_reconciliation",

                  payoutId:
                    String(
                      row.id,
                    ),
                },
              },
            );
          }
        },
      );
    }
  } catch (
    error
  ) {
    console.error(
      "Payout reconciliation failed:",
      error,
    );
  } finally {
    payoutReconcilerBusy =
      false;
  }
}


export function startQrPayoutReconciler() {
  if (
    payoutReconcilerStarted ||
    process.env
      .BRIXTA_BACKEND_EDITION !==
      "qr-voucher-rewards"
  ) {
    return;
  }

  payoutReconcilerStarted =
    true;

  const interval =
    setInterval(
      () => {
        void payoutReconcileTick();
      },
      15_000,
    );

  interval.unref();

  console.log(
    " QR payout reconciler: ENABLED",
  );
}

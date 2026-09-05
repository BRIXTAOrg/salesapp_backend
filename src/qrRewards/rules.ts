import {
  randomUUID,
} from "node:crypto";

import {
  sql,
} from "drizzle-orm";

import type {
  AppDatabase,
} from "../db/db";


export type RulebookSnapshot = {
  schemeId:
    string;

  schemeName:
    string;

  rulebookId:
    string;

  rulebookVersion:
    number;

  rulesHash:
    string;

  rewardPolicy:
    Record<string, unknown>;

  claimLimitPolicy:
    Record<string, unknown>;

  fraudPolicy:
    Record<string, unknown>;

  validityPolicy:
    Record<string, unknown>;
};


export type RuleContext = {
  voucherId:
    string;

  assignmentId:
    string;

  campaignId:
    string;

  claimantKeyHash?:
    string | null;

  userId?:
    number | null;

  entityTypeId?:
    number | null;

  entityRecordId?:
    string | null;
};


export type RuleResult = {
  decision:
    | "pass"
    | "fail";

  reasonCodes:
    string[];

  rewardAmountMinor?:
    number;
};


function objectValue(
  value: unknown,
) {
  return (
    value &&
    typeof value ===
      "object" &&
    !Array.isArray(
      value,
    )
  )
    ? value as
        Record<string, unknown>
    : {};
}


function numeric(
  value: unknown,
  fallback = 0,
) {
  const result =
    Number(
      value,
    );

  return Number.isFinite(
    result,
  )
    ? result
    : fallback;
}


function positiveInteger(
  value: unknown,
) {
  const result =
    Math.floor(
      numeric(
        value,
      ),
    );

  return result >
    0
    ? result
    : 0;
}


function stringArray(
  value: unknown,
) {
  return Array.isArray(
    value,
  )
    ? value
        .map(String)
        .filter(Boolean)
    : [];
}


function rewardAmount(
  policy:
    Record<string, unknown>,
  context:
    RuleContext,
) {
  const type =
    String(
      policy.type ??
      "fixed",
    );


  if (
    type ===
    "fixed"
  ) {
    const amount =
      Math.round(
        numeric(
          policy.amountMinor,
        ),
      );

    return amount >
      0
      ? amount
      : null;
  }


  if (
    type !==
    "formula"
  ) {
    return null;
  }


  let amount =
    numeric(
      policy.baseAmountMinor,
    );


  const adjustments =
    Array.isArray(
      policy.adjustments,
    )
      ? policy.adjustments
      : [];


  for (
    const raw of
    adjustments
  ) {
    const adjustment =
      objectValue(
        raw,
      );

    const requiredRecord =
      adjustment.entityRecordId
        ? String(
            adjustment.entityRecordId,
          )
        : null;

    const requiredType =
      adjustment.entityTypeId !==
        undefined
        ? Number(
            adjustment.entityTypeId,
          )
        : null;


    if (
      requiredRecord &&
      requiredRecord !==
        context.entityRecordId
    ) {
      continue;
    }


    if (
      requiredType !==
        null &&
      requiredType !==
        Number(
          context.entityTypeId ??
          0,
        )
    ) {
      continue;
    }


    amount +=
      numeric(
        adjustment.addAmountMinor,
      );


    amount =
      amount *
      numeric(
        adjustment.multiplyBasisPoints,
        10_000,
      ) /
      10_000;
  }


  amount =
    Math.max(
      numeric(
        policy.minAmountMinor,
      ),
      Math.min(
        numeric(
          policy.maxAmountMinor,
          Number.MAX_SAFE_INTEGER,
        ),
        amount,
      ),
    );


  const result =
    Math.round(
      amount,
    );

  return result >
    0
    ? result
    : null;
}


async function countClaims(
  db: AppDatabase,
  where:
    ReturnType<typeof sql>,
) {
  const result =
    await db.execute(sql`
      SELECT
        COUNT(*)::integer
          AS count

      FROM
        qr_reward_claims
          AS claim

      WHERE
        ${where}
    `);


  return Number(
    (
      result.rows[0] as
        | {
            count?: unknown;
          }
        | undefined
    )?.count ??
    0,
  );
}


export async function evaluateRulebook(
  db: AppDatabase,
  input: {
    phase:
      | "preflight"
      | "claim_gate";

    rulebook:
      RulebookSnapshot;

    context:
      RuleContext;
  },
): Promise<
  RuleResult
> {
  const fraud =
    objectValue(
      input.rulebook
        .fraudPolicy,
    );

  const limits =
    objectValue(
      input.rulebook
        .claimLimitPolicy,
    );

  const reasons:
    string[] = [];


  if (
    fraud.requireEntity ===
      true &&
    !input.context
      .entityRecordId
  ) {
    reasons.push(
      "ENTITY_REQUIRED",
    );
  }


  const blockedEntities =
    stringArray(
      fraud.blockedEntityRecordIds,
    );


  if (
    input.context
      .entityRecordId &&
    blockedEntities.includes(
      input.context
        .entityRecordId,
    )
  ) {
    reasons.push(
      "ENTITY_BLOCKED",
    );
  }


  if (
    input.phase ===
    "claim_gate"
  ) {
    const claimantDay =
      positiveInteger(
        limits.perClaimantPerDay,
      );

    const claimantCampaign =
      positiveInteger(
        limits.perClaimantPerCampaign,
      );

    const entityDay =
      positiveInteger(
        limits.perEntityPerDay,
      );


    if (
      (
        claimantDay >
          0 ||
        claimantCampaign >
          0
      ) &&
      !input.context
        .claimantKeyHash
    ) {
      reasons.push(
        "CLAIMANT_KEY_REQUIRED",
      );
    }


    if (
      input.context
        .claimantKeyHash &&
      claimantDay >
        0
    ) {
      const count =
        await countClaims(
          db,
          sql`
            claim.claimant_key_hash =
              ${input.context.claimantKeyHash}

            AND
            claim.claimed_at >=
              date_trunc(
                'day',
                now()
              )
          `,
        );

      if (
        count >=
        claimantDay
      ) {
        reasons.push(
          "CLAIMANT_DAILY_LIMIT_EXCEEDED",
        );
      }
    }


    if (
      input.context
        .claimantKeyHash &&
      claimantCampaign >
        0
    ) {
      const count =
        await countClaims(
          db,
          sql`
            claim.claimant_key_hash =
              ${input.context.claimantKeyHash}

            AND
            claim.campaign_id_snapshot =
              ${input.context.campaignId}::uuid
          `,
        );

      if (
        count >=
        claimantCampaign
      ) {
        reasons.push(
          "CLAIMANT_CAMPAIGN_LIMIT_EXCEEDED",
        );
      }
    }


    if (
      input.context
        .entityRecordId &&
      entityDay >
        0
    ) {
      const count =
        await countClaims(
          db,
          sql`
            claim.entity_record_id_snapshot =
              ${input.context.entityRecordId}::uuid

            AND
            claim.claimed_at >=
              date_trunc(
                'day',
                now()
              )
          `,
        );

      if (
        count >=
        entityDay
      ) {
        reasons.push(
          "ENTITY_DAILY_LIMIT_EXCEEDED",
        );
      }
    }


    const minimumSeconds =
      positiveInteger(
        fraud.minSecondsBetweenClaimsPerClaimant,
      );


    if (
      minimumSeconds >
        0 &&
      input.context
        .claimantKeyHash
    ) {
      const recent =
        await db.execute(sql`
          SELECT
            MAX(
              claimed_at
            )
              AS "lastClaimedAt"

          FROM
            qr_reward_claims

          WHERE
            claimant_key_hash =
              ${input.context.claimantKeyHash}
        `);


      const value =
        (
          recent.rows[0] as
            | {
                lastClaimedAt?: unknown;
              }
            | undefined
        )?.lastClaimedAt;


      if (
        value
      ) {
        const elapsedSeconds =
          (
            Date.now() -
            new Date(
              String(
                value,
              ),
            ).getTime()
          ) /
          1000;


        if (
          elapsedSeconds <
          minimumSeconds
        ) {
          reasons.push(
            "CLAIMANT_VELOCITY_REJECTED",
          );
        }
      }
    }
  }


  const reward =
    rewardAmount(
      objectValue(
        input.rulebook
          .rewardPolicy,
      ),
      input.context,
    );


  if (
    reward ===
    null
  ) {
    reasons.push(
      "REWARD_POLICY_INVALID",
    );
  }


  if (
    reasons.length
  ) {
    return {
      decision:
        "fail",

      reasonCodes:
        reasons,
    };
  }


  return {
    decision:
      "pass",

    reasonCodes:
      [],

    rewardAmountMinor:
      reward ??
      undefined,
  };
}


export async function writeRuleEvaluation(
  db: AppDatabase,
  input: {
    voucherId?:
      string | null;

    assignmentId?:
      string | null;

    claimId?:
      string | null;

    rulebook:
      RulebookSnapshot;

    phase:
      | "preflight"
      | "claim_gate";

    decision:
      | "pass"
      | "fail";

    reasonCodes:
      string[];

    facts?:
      Record<string, unknown>;
  },
) {
  await db.execute(sql`
    INSERT INTO
      qr_reward_rule_evaluations (
        id,
        voucher_id,
        assignment_id,
        claim_id,
        scheme_id,
        rulebook_id,
        rulebook_version,
        phase,
        decision,
        reason_codes,
        facts,
        evaluated_at
      )

    VALUES (
      ${randomUUID()}::uuid,

      ${
        input.voucherId ??
        null
      }::uuid,

      ${
        input.assignmentId ??
        null
      }::uuid,

      ${
        input.claimId ??
        null
      }::uuid,

      ${input.rulebook.schemeId}::uuid,

      ${input.rulebook.rulebookId}::uuid,

      ${input.rulebook.rulebookVersion},

      ${input.phase},

      ${input.decision},

      ${JSON.stringify(
        input.reasonCodes,
      )}::jsonb,

      ${JSON.stringify(
        input.facts ??
        {},
      )}::jsonb,

      now()
    )
  `);
}

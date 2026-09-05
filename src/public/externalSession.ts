import {
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import {
  requiredSecret,
} from "../platform/security/secretBox";


export type ExternalSession = {
  tenant: string;
  responsibilityKey: string;
  sessionId: string;
  exp: number;
  userId?: number;
};


function secret() {
  return requiredSecret(
    "BRIXTA_EXTERNAL_SESSION_SECRET",
  );
}


function encode(
  value: unknown,
) {
  return Buffer
    .from(
      JSON.stringify(value),
      "utf8",
    )
    .toString(
      "base64url",
    );
}


function sign(
  content: string,
) {
  return createHmac(
    "sha256",
    secret(),
  )
    .update(
      content,
      "utf8",
    )
    .digest(
      "base64url",
    );
}


export function createExternalSession(
  input: {
    tenant: string;
    responsibilityKey: string;
    userId?: number | null;
    ttlSeconds?: number;
  },
) {
  const payload:
    ExternalSession = {
    tenant:
      input.tenant,

    responsibilityKey:
      input.responsibilityKey,

    sessionId:
      randomUUID(),

    exp:
      Math.floor(
        Date.now() / 1000,
      ) +
      (
        input.ttlSeconds ??
        86_400
      ),
  };

  if (
    Number.isInteger(
      Number(
        input.userId,
      ),
    ) &&
    Number(
      input.userId,
    ) > 0
  ) {
    payload.userId =
      Number(
        input.userId,
      );
  }

  const body =
    encode(
      payload,
    );

  return {
    token:
      `v1.${body}.${sign(`v1.${body}`)}`,

    payload,
  };
}


export function verifyExternalSession(
  token: string,
): ExternalSession | null {
  const [
    version,
    body,
    signature,
  ] =
    token.split(".");

  if (
    version !== "v1" ||
    !body ||
    !signature
  ) {
    return null;
  }

  const expected =
    sign(
      `${version}.${body}`,
    );

  const left =
    Buffer.from(
      signature,
      "utf8",
    );

  const right =
    Buffer.from(
      expected,
      "utf8",
    );

  if (
    left.length !==
      right.length ||
    !timingSafeEqual(
      left,
      right,
    )
  ) {
    return null;
  }

  try {
    const parsed =
      JSON.parse(
        Buffer
          .from(
            body,
            "base64url",
          )
          .toString(
            "utf8",
          ),
      ) as
        ExternalSession;

    if (
      !parsed.tenant ||
      !parsed.responsibilityKey ||
      !parsed.sessionId ||
      !Number.isFinite(
        parsed.exp,
      ) ||
      parsed.exp <=
        Math.floor(
          Date.now() / 1000,
        )
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

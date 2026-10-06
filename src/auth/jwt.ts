import jwt, {
  type JwtPayload,
  type Secret,
} from "jsonwebtoken";

export interface MobileJwtPayload {
  userId: number;
  schemaName: string;
  email: string;
  username: string | null;
  orgRole: string;
  phoneNumber?: string | null;
  area?: string | null;
  zone?: string | null;
}

function getJwtSecret(): Secret {
  const secret =
    process.env.JWT_SECRET;

  if (!secret) {
    throw new Error(
      "JWT_SECRET must be set. Refusing to sign or verify tokens without a secret.",
    );
  }

  return secret;
}

function isMobileJwtPayload(
  value: JwtPayload,
): value is JwtPayload & MobileJwtPayload {
  return (
    Number.isInteger(value.userId) &&
    typeof value.schemaName === "string" &&
    typeof value.email === "string" &&
    (
      typeof value.username === "string" ||
      value.username === null
    ) &&
    typeof value.orgRole === "string" &&
    (
      value.phoneNumber === undefined ||
      value.phoneNumber === null ||
      typeof value.phoneNumber === "string"
    ) &&
    (
      value.area === undefined ||
      value.area === null ||
      typeof value.area === "string"
    ) &&
    (
      value.zone === undefined ||
      value.zone === null ||
      typeof value.zone === "string"
    )
  );
}

// BRIXTA_MOBILE_TOKEN_AUDIENCE_V1
// Mobile tokens are stamped "brixta-mobile"; dashboard cookies are stamped
// "brixta-cms". Even when both services share JWT_SECRET, a dashboard
// cookie can no longer be used as a mobile token (or the other way round).
export const MOBILE_TOKEN_AUDIENCE =
  "brixta-mobile";

export function signMobileToken(
  payload: MobileJwtPayload,
): string {
  return jwt.sign(
    payload,
    getJwtSecret(),
    {
      algorithm: "HS256",
      audience: MOBILE_TOKEN_AUDIENCE,
      expiresIn: "7d",
    },
  );
}

function hasMobileAudience(
  decoded: JwtPayload,
) {
  if (decoded.aud === undefined) {
    // Tokens issued before the audience stamp (they expire within 7 days).
    // Dashboard cookies always carry a permissions list; mobile tokens
    // never do.
    return !Object.prototype.hasOwnProperty.call(
      decoded,
      "permissions",
    );
  }

  const audiences =
    Array.isArray(decoded.aud)
      ? decoded.aud
      : [decoded.aud];

  return audiences.includes(
    MOBILE_TOKEN_AUDIENCE,
  );
}

export function verifyMobileToken(
  token: string,
): MobileJwtPayload {
  const decoded =
    jwt.verify(
      token,
      getJwtSecret(),
      {
        algorithms: ["HS256"],
      },
    );

  if (
    typeof decoded === "string" ||
    !hasMobileAudience(decoded) ||
    !isMobileJwtPayload(decoded)
  ) {
    throw new Error(
      "Invalid mobile token payload.",
    );
  }

  return {
    userId: decoded.userId,
    schemaName: decoded.schemaName,
    email: decoded.email,
    username: decoded.username,
    orgRole: decoded.orgRole,
    phoneNumber:
      decoded.phoneNumber,
    area: decoded.area,
    zone: decoded.zone,
  };
}

import jwt, {
  type JwtPayload,
  type Secret,
} from "jsonwebtoken";

export interface MobileJwtPayload {
  userId: number;
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

export function signMobileToken(
  payload: MobileJwtPayload,
): string {
  return jwt.sign(
    payload,
    getJwtSecret(),
    {
      expiresIn: "7d",
    },
  );
}

export function verifyMobileToken(
  token: string,
): MobileJwtPayload {
  const decoded =
    jwt.verify(
      token,
      getJwtSecret(),
    );

  if (
    typeof decoded === "string" ||
    !isMobileJwtPayload(decoded)
  ) {
    throw new Error(
      "Invalid mobile token payload.",
    );
  }

  return {
    userId: decoded.userId,
    email: decoded.email,
    username: decoded.username,
    orgRole: decoded.orgRole,
    phoneNumber:
      decoded.phoneNumber,
    area: decoded.area,
    zone: decoded.zone,
  };
}
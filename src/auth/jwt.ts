import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error(
    "JWT_SECRET must be set. Refusing to start with an insecure fallback secret.",
  );
}

export interface MobileJwtPayload {
  userId: number;
  email: string;
  username: string | null;
  orgRole: string;
  phoneNumber?: string | null;
  area?: string | null;
  zone?: string | null;
}

export function signMobileToken(payload: MobileJwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: "7d",
  });
}

export function verifyMobileToken(token: string): MobileJwtPayload {
  return jwt.verify(token, JWT_SECRET) as MobileJwtPayload;
}

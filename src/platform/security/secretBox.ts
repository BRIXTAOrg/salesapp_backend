import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";


function deriveKey(
  material: string,
) {
  return createHash(
    "sha256",
  )
    .update(
      material,
      "utf8",
    )
    .digest();
}


export function requiredSecret(
  ...names: string[]
) {
  for (
    const name of names
  ) {
    const value =
      process.env[
        name
      ]?.trim();

    if (
      value
    ) {
      return value;
    }
  }

  throw new Error(
    `Missing required secret: ${names.join(" or ")}`,
  );
}


export function encryptSecretBox(
  value: string,
  material: string,
) {
  const iv =
    randomBytes(
      12,
    );

  const cipher =
    createCipheriv(
      "aes-256-gcm",
      deriveKey(
        material,
      ),
      iv,
    );

  const encrypted =
    Buffer.concat([
      cipher.update(
        value,
        "utf8",
      ),
      cipher.final(),
    ]);

  const tag =
    cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}


export function decryptSecretBox(
  envelope: string,
  material: string,
) {
  const [
    version,
    ivRaw,
    tagRaw,
    encryptedRaw,
  ] =
    envelope.split(".");

  if (
    version !== "v1" ||
    !ivRaw ||
    !tagRaw ||
    !encryptedRaw
  ) {
    throw new Error(
      "Invalid encrypted secret envelope.",
    );
  }

  const decipher =
    createDecipheriv(
      "aes-256-gcm",
      deriveKey(
        material,
      ),
      Buffer.from(
        ivRaw,
        "base64url",
      ),
    );

  decipher.setAuthTag(
    Buffer.from(
      tagRaw,
      "base64url",
    ),
  );

  return Buffer.concat([
    decipher.update(
      Buffer.from(
        encryptedRaw,
        "base64url",
      ),
    ),
    decipher.final(),
  ]).toString(
    "utf8",
  );
}

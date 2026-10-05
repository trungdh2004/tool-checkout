import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function parseMasterKey(value) {
  if (!value) {
    throw new Error("REPLAY_MASTER_KEY is required");
  }

  const key = /^[0-9a-f]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new Error("REPLAY_MASTER_KEY must encode exactly 32 bytes");
  }
  return key;
}

export function encryptSecret(plaintext, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSecret(payload, key) {
  const [version, iv, tag, ciphertext] = String(payload).split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) {
    throw new Error("encrypted credential has an invalid format");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

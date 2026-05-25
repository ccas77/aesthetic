import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
} from "node:crypto";

// AES-256-GCM encryption for OAuth tokens at rest. Keyed off
// HIGGSFIELD_TOKEN_SECRET; hashed to 32 bytes so any string length works.
function key(): Buffer {
  const secret = process.env.HIGGSFIELD_TOKEN_SECRET;
  if (!secret) {
    throw new Error("HIGGSFIELD_TOKEN_SECRET not set");
  }
  return createHash("sha256").update(secret).digest();
}

const FORMAT = "v1";

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    FORMAT,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ct.toString("base64url"),
  ].join(".");
}

export function decryptToken(payload: string): string {
  const [format, ivB64, tagB64, ctB64] = payload.split(".");
  if (format !== FORMAT) {
    throw new Error(`unknown token ciphertext format: ${format}`);
  }
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const ct = Buffer.from(ctB64, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
    "utf8",
  );
}

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const PREFIX = "enc:v1:";
const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function loadKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY env var is required. Generate one with: openssl rand -base64 32"
    );
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode to 32 bytes (got ${buf.length}). Generate with: openssl rand -base64 32`
    );
  }
  return buf;
}

const KEY = loadKey();

export function encrypt(plaintext: string | null | undefined): string {
  if (plaintext === null || plaintext === undefined || plaintext === "") {
    return plaintext as string;
  }
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, KEY, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decrypt(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return value as string;
  }
  if (!value.startsWith(PREFIX)) {
    return value;
  }
  const parts = value.slice(PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid ciphertext: expected enc:v1:<iv>:<tag>:<ct>");
  }
  const iv = Buffer.from(parts[0], "base64");
  const tag = Buffer.from(parts[1], "base64");
  const ct = Buffer.from(parts[2], "base64");
  if (iv.length !== IV_LEN) throw new Error(`Invalid IV length: ${iv.length}`);
  if (tag.length !== TAG_LEN) throw new Error(`Invalid auth tag length: ${tag.length}`);
  const decipher = createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export function encryptJson(obj: unknown): string | null {
  if (obj === null || obj === undefined) return obj as null;
  return encrypt(JSON.stringify(obj));
}

export function decryptJson<T = unknown>(value: string | null | undefined): T | null {
  if (value === null || value === undefined || value === "") return null;
  const plain = decrypt(value);
  return JSON.parse(plain) as T;
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

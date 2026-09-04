import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

/**
 * Real AES-256-GCM encryption for dotfiles-sync "secret" manifest entries.
 *
 * On-disk format: a JSON envelope (see EncryptedEnvelope) with all binary
 * fields base64-encoded. The salt is stored per-file and used together with
 * the user's passphrase to derive a 32-byte key via scrypt. A fresh random
 * IV is generated for every encryption call. The GCM authentication tag is
 * stored alongside the ciphertext and verified on decrypt -- any tampering
 * with the ciphertext, IV, salt, or tag causes decryption to throw.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256-bit key
const IV_LENGTH = 12; // 96-bit IV, recommended size for GCM
const SALT_LENGTH = 16; // 128-bit salt

// scrypt cost parameters. N must be a power of two; these are Node's own
// scrypt defaults (also OWASP's minimum recommendation as of 2023).
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;

export const ENVELOPE_VERSION = 1 as const;

export interface EncryptedEnvelope {
  version: typeof ENVELOPE_VERSION;
  algorithm: "aes-256-gcm";
  kdf: "scrypt";
  /** base64-encoded scrypt salt (per-file, random) */
  salt: string;
  /** base64-encoded AES-GCM IV */
  iv: string;
  /** base64-encoded GCM authentication tag */
  authTag: string;
  /** base64-encoded ciphertext */
  ciphertext: string;
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_LENGTH, SCRYPT_PARAMS);
}

/** Encrypt a plaintext buffer with a passphrase, producing a self-contained envelope. */
export function encryptBuffer(plaintext: Buffer, passphrase: string): EncryptedEnvelope {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = deriveKey(passphrase, salt);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    version: ENVELOPE_VERSION,
    algorithm: ALGORITHM,
    kdf: "scrypt",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

/**
 * Decrypt an envelope with a passphrase. Throws if the passphrase is wrong
 * or if the ciphertext/IV/salt/authTag were tampered with (GCM auth failure).
 */
export function decryptBuffer(envelope: EncryptedEnvelope, passphrase: string): Buffer {
  if (envelope.version !== ENVELOPE_VERSION || envelope.algorithm !== ALGORITHM) {
    throw new Error(
      `Unsupported encrypted envelope (version=${String(envelope.version)}, algorithm=${String(envelope.algorithm)})`
    );
  }
  const salt = Buffer.from(envelope.salt, "base64");
  const iv = Buffer.from(envelope.iv, "base64");
  const authTag = Buffer.from(envelope.authTag, "base64");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  const key = deriveKey(passphrase, salt);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  // Throws (bad auth tag) if ciphertext/iv/authTag/salt were tampered with,
  // or if the passphrase (hence derived key) is wrong.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function serializeEnvelope(envelope: EncryptedEnvelope): string {
  return JSON.stringify(envelope, null, 2) + "\n";
}

export function parseEnvelope(json: string): EncryptedEnvelope {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (err) {
    throw new Error(`Encrypted file is not valid JSON: ${(err as Error).message}`);
  }
  if (data === null || typeof data !== "object") {
    throw new Error("Invalid or corrupt encrypted envelope");
  }
  const d = data as Record<string, unknown>;
  if (
    d.version !== ENVELOPE_VERSION ||
    d.algorithm !== ALGORITHM ||
    d.kdf !== "scrypt" ||
    typeof d.salt !== "string" ||
    typeof d.iv !== "string" ||
    typeof d.authTag !== "string" ||
    typeof d.ciphertext !== "string"
  ) {
    throw new Error("Invalid or corrupt encrypted envelope");
  }
  return {
    version: ENVELOPE_VERSION,
    algorithm: ALGORITHM,
    kdf: "scrypt",
    salt: d.salt,
    iv: d.iv,
    authTag: d.authTag,
    ciphertext: d.ciphertext,
  };
}

/** Encrypt a file on disk into an envelope JSON file at destPath. */
export function encryptFile(sourcePath: string, destPath: string, passphrase: string): void {
  const plaintext = readFileSync(sourcePath);
  const envelope = encryptBuffer(plaintext, passphrase);
  writeFileSync(destPath, serializeEnvelope(envelope), { mode: 0o600 });
}

/** Decrypt an envelope JSON file from disk, returning the plaintext buffer. */
export function decryptFile(encFilePath: string, passphrase: string): Buffer {
  const json = readFileSync(encFilePath, "utf8");
  const envelope = parseEnvelope(json);
  return decryptBuffer(envelope, passphrase);
}

/**
 * Resolve the passphrase used to derive the AES key: the DOTFILES_SYNC_PASSPHRASE
 * env var if set, otherwise an interactive (non-hidden) readline prompt.
 */
export async function resolvePassphrase(): Promise<string> {
  const fromEnv = process.env.DOTFILES_SYNC_PASSPHRASE;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }
  return promptPassphrase();
}

function promptPassphrase(): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(
      "Enter DOTFILES_SYNC_PASSPHRASE (NOTE: input is not hidden here; set the env var for real use/CI): ",
      (answer) => {
        rl.close();
        if (!answer) {
          reject(new Error("No passphrase provided"));
          return;
        }
        resolvePromise(answer);
      }
    );
  });
}

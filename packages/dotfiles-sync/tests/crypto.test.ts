import { describe, expect, it } from "vitest";
import { decryptBuffer, encryptBuffer, parseEnvelope, serializeEnvelope } from "../src/crypto.js";

function flipLastByte(base64: string): string {
  const buf = Buffer.from(base64, "base64");
  const lastIndex = buf.length - 1;
  buf[lastIndex] = (buf[lastIndex] ?? 0) ^ 0xff;
  return buf.toString("base64");
}

describe("crypto: AES-256-GCM round trip", () => {
  const passphrase = "correct horse battery staple";

  it("decrypts back to the original plaintext with the correct passphrase", () => {
    const plaintext = Buffer.from("super secret dotfile contents\nwith multiple lines\n", "utf8");
    const envelope = encryptBuffer(plaintext, passphrase);
    const decrypted = decryptBuffer(envelope, passphrase);
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it("never reuses the IV or produces identical ciphertext across calls", () => {
    const plaintext = Buffer.from("same content every time", "utf8");
    const a = encryptBuffer(plaintext, passphrase);
    const b = encryptBuffer(plaintext, passphrase);
    expect(a.iv).not.toBe(b.iv);
    expect(a.salt).not.toBe(b.salt);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("throws when decrypting with the wrong passphrase", () => {
    const plaintext = Buffer.from("top secret", "utf8");
    const envelope = encryptBuffer(plaintext, passphrase);
    expect(() => decryptBuffer(envelope, "definitely the wrong passphrase")).toThrow();
  });

  it("throws when the ciphertext has been tampered with", () => {
    const plaintext = Buffer.from("integrity matters", "utf8");
    const envelope = encryptBuffer(plaintext, passphrase);
    const tampered = { ...envelope, ciphertext: flipLastByte(envelope.ciphertext) };
    expect(() => decryptBuffer(tampered, passphrase)).toThrow();
  });

  it("throws when the auth tag has been tampered with", () => {
    const plaintext = Buffer.from("integrity matters too", "utf8");
    const envelope = encryptBuffer(plaintext, passphrase);
    const tampered = { ...envelope, authTag: flipLastByte(envelope.authTag) };
    expect(() => decryptBuffer(tampered, passphrase)).toThrow();
  });

  it("round-trips through JSON serialize/parse", () => {
    const plaintext = Buffer.from("serialize me please", "utf8");
    const envelope = encryptBuffer(plaintext, passphrase);
    const json = serializeEnvelope(envelope);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = parseEnvelope(json);
    const decrypted = decryptBuffer(parsed, passphrase);
    expect(decrypted.toString("utf8")).toBe("serialize me please");
  });

  it("rejects a malformed/foreign envelope shape", () => {
    expect(() => parseEnvelope(JSON.stringify({ foo: "bar" }))).toThrow();
    expect(() => parseEnvelope("{ not json")).toThrow();
  });
});

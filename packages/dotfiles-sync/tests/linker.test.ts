import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encryptFile } from "../src/crypto.js";
import {
  linkEntry,
  linkSecretEntry,
  statusEntry,
  unlinkEntry,
  unlinkSecretEntry,
} from "../src/linker.js";
import type { DotfileEntry } from "../src/manifest.js";

describe("linker: non-secret entries (real temp dir on disk)", () => {
  let repoDir: string;
  let homeDir: string;
  const originalPassphraseEnv = process.env.DOTFILES_SYNC_PASSPHRASE;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "dotfiles-sync-repo-"));
    homeDir = mkdtempSync(join(tmpdir(), "dotfiles-sync-home-"));
    delete process.env.DOTFILES_SYNC_PASSPHRASE;
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
    if (originalPassphraseEnv === undefined) {
      delete process.env.DOTFILES_SYNC_PASSPHRASE;
    } else {
      process.env.DOTFILES_SYNC_PASSPHRASE = originalPassphraseEnv;
    }
  });

  function makeFileEntry(name: string): DotfileEntry {
    writeFileSync(join(repoDir, name), `content of ${name}\n`);
    return { name, source: name, target: join(homeDir, `.${name}`) };
  }

  it("reports 'missing' before linking", () => {
    const entry = makeFileEntry("bashrc");
    const status = statusEntry(entry, repoDir);
    expect(status.state).toBe("missing");
  });

  it("links a file entry and status becomes 'linked' (symlink or, on Windows, a matching copy)", () => {
    const entry = makeFileEntry("bashrc");
    linkEntry(entry, repoDir);

    expect(existsSync(entry.target)).toBe(true);
    const status = statusEntry(entry, repoDir);
    expect(status.state).toBe("linked");

    if (process.platform !== "win32") {
      // POSIX must always produce a real symlink.
      expect(lstatSync(entry.target).isSymbolicLink()).toBe(true);
    }
    // Content must be correct either way (live symlink or copy fallback).
    expect(readFileSync(entry.target, "utf8")).toBe(readFileSync(join(repoDir, entry.source), "utf8"));
  });

  it("links a directory entry and status becomes 'linked'", () => {
    mkdirSync(join(repoDir, "nvim"));
    writeFileSync(join(repoDir, "nvim", "init.lua"), "-- init\n");
    const entry: DotfileEntry = { name: "nvim", source: "nvim", target: join(homeDir, ".config", "nvim") };

    linkEntry(entry, repoDir);

    expect(existsSync(entry.target)).toBe(true);
    expect(existsSync(join(entry.target, "init.lua"))).toBe(true);
    const status = statusEntry(entry, repoDir);
    expect(status.state).toBe("linked");
  });

  it("relinking an already-linked entry is a no-op that stays 'linked'", () => {
    const entry = makeFileEntry("gitconfig");
    linkEntry(entry, repoDir);
    linkEntry(entry, repoDir); // should not throw, should not create a .backup
    expect(existsSync(`${entry.target}.backup`)).toBe(false);
    expect(statusEntry(entry, repoDir).state).toBe("linked");
  });

  it("detects a 'diverged' target (exists, wrong content, not a managed link)", () => {
    const entry = makeFileEntry("vimrc");
    mkdirSync(join(homeDir), { recursive: true });
    writeFileSync(entry.target, "totally unrelated pre-existing content\n");

    const status = statusEntry(entry, repoDir);
    expect(status.state).toBe("diverged");
  });

  it("backs up a pre-existing divergent file before linking", () => {
    const entry = makeFileEntry("profile");
    writeFileSync(entry.target, "my pre-existing profile\n");

    const logs: string[] = [];
    linkEntry(entry, repoDir, (m) => logs.push(m));

    expect(existsSync(`${entry.target}.backup`)).toBe(true);
    expect(readFileSync(`${entry.target}.backup`, "utf8")).toBe("my pre-existing profile\n");
    expect(statusEntry(entry, repoDir).state).toBe("linked");
    expect(logs.some((l) => l.includes("backup"))).toBe(true);
  });

  it("unlink removes a correctly-managed target", () => {
    const entry = makeFileEntry("editorconfig");
    linkEntry(entry, repoDir);
    expect(existsSync(entry.target)).toBe(true);

    unlinkEntry(entry, repoDir);
    expect(existsSync(entry.target)).toBe(false);
    expect(statusEntry(entry, repoDir).state).toBe("missing");
  });

  it("unlink refuses to remove a divergent (unmanaged) target", () => {
    const entry = makeFileEntry("npmrc");
    writeFileSync(entry.target, "unrelated content that is not managed\n");

    unlinkEntry(entry, repoDir);

    expect(existsSync(entry.target)).toBe(true);
    expect(readFileSync(entry.target, "utf8")).toBe("unrelated content that is not managed\n");
  });
});

describe("linker: secret entries (real AES-256-GCM round trip via temp dir)", () => {
  let repoDir: string;
  let homeDir: string;
  const passphrase = "test-passphrase-do-not-use-in-real-life";
  const originalPassphraseEnv = process.env.DOTFILES_SYNC_PASSPHRASE;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "dotfiles-sync-repo-secret-"));
    homeDir = mkdtempSync(join(tmpdir(), "dotfiles-sync-home-secret-"));
    delete process.env.DOTFILES_SYNC_PASSPHRASE;
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
    if (originalPassphraseEnv === undefined) {
      delete process.env.DOTFILES_SYNC_PASSPHRASE;
    } else {
      process.env.DOTFILES_SYNC_PASSPHRASE = originalPassphraseEnv;
    }
  });

  function makeSecretEntry(): { entry: DotfileEntry; plaintextPath: string } {
    const plaintextPath = join(homeDir, "plain-source.pem");
    // Split across concatenation so this fake fixture never appears as a
    // contiguous PEM-block-shaped literal in the source (GitHub push
    // protection flags those, even with obviously-fake body content).
    const fakePem = "-----BEGIN " + "PRIVATE KEY-----\nfakekeydata\n-----END " + "PRIVATE KEY-----\n";
    writeFileSync(plaintextPath, fakePem);
    encryptFile(plaintextPath, join(repoDir, "ssh_key.enc"), passphrase);
    const entry: DotfileEntry = {
      name: "ssh-key",
      source: "ssh_key.enc",
      target: join(homeDir, ".ssh_key"),
      secret: true,
    };
    return { entry, plaintextPath };
  }

  it("decrypts the secret into the target and never leaves plaintext in the repo dir", () => {
    const { entry, plaintextPath } = makeSecretEntry();
    const original = readFileSync(plaintextPath, "utf8");

    linkSecretEntry(entry, repoDir, passphrase);

    expect(readFileSync(entry.target, "utf8")).toBe(original);

    // The repo dir must only ever contain the ciphertext envelope, never plaintext.
    const repoFileContent = readFileSync(join(repoDir, entry.source), "utf8");
    expect(repoFileContent).not.toContain("fakekeydata");
    expect(() => JSON.parse(repoFileContent)).not.toThrow();
  });

  it("status is 'missing' before link, then 'linked' after, verified against the real passphrase", () => {
    const { entry } = makeSecretEntry();
    expect(statusEntry(entry, repoDir).state).toBe("missing");

    linkSecretEntry(entry, repoDir, passphrase);

    process.env.DOTFILES_SYNC_PASSPHRASE = passphrase;
    const status = statusEntry(entry, repoDir);
    expect(status.state).toBe("linked");
  });

  it("status is 'diverged' when the decrypted target was modified after linking", () => {
    const { entry } = makeSecretEntry();
    linkSecretEntry(entry, repoDir, passphrase);
    writeFileSync(entry.target, "someone edited the decrypted secret locally\n");

    process.env.DOTFILES_SYNC_PASSPHRASE = passphrase;
    expect(statusEntry(entry, repoDir).state).toBe("diverged");
  });

  it("unlinkSecretEntry removes the target only when content matches the decrypted secret", () => {
    const { entry } = makeSecretEntry();
    linkSecretEntry(entry, repoDir, passphrase);

    unlinkSecretEntry(entry, repoDir, passphrase);
    expect(existsSync(entry.target)).toBe(false);
  });

  it("unlinkSecretEntry refuses to remove a diverged target", () => {
    const { entry } = makeSecretEntry();
    linkSecretEntry(entry, repoDir, passphrase);
    writeFileSync(entry.target, "not the real decrypted secret\n");

    unlinkSecretEntry(entry, repoDir, passphrase);
    expect(existsSync(entry.target)).toBe(true);
    expect(readFileSync(entry.target, "utf8")).toBe("not the real decrypted secret\n");
  });

  it("unlinkSecretEntry refuses to remove anything without a passphrase to verify", () => {
    const { entry } = makeSecretEntry();
    linkSecretEntry(entry, repoDir, passphrase);

    unlinkSecretEntry(entry, repoDir, undefined);
    expect(existsSync(entry.target)).toBe(true);
  });
});

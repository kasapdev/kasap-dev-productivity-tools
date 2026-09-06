import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  expandHome,
  loadManifest,
  resolveSourcePath,
  resolveTargetPath,
  validateManifest,
} from "../src/manifest.js";

describe("validateManifest", () => {
  it("accepts a well-formed manifest and defaults secret to false", () => {
    const manifest = validateManifest({
      entries: [
        { name: "gitconfig", source: "git/gitconfig", target: "~/.gitconfig" },
        { name: "ssh-key", source: "ssh/id.enc", target: "~/.ssh/id_ed25519", secret: true },
      ],
    });
    expect(manifest.entries).toHaveLength(2);
    expect(manifest.entries[0]?.secret).toBe(false);
    expect(manifest.entries[1]?.secret).toBe(true);
  });

  it("rejects a non-object root", () => {
    expect(() => validateManifest([])).toThrow();
    expect(() => validateManifest("nope")).toThrow();
    expect(() => validateManifest(null)).toThrow();
  });

  it("rejects a manifest missing the entries array", () => {
    expect(() => validateManifest({})).toThrow();
  });

  it("rejects an entry missing required fields", () => {
    expect(() => validateManifest({ entries: [{ name: "x" }] })).toThrow();
    expect(() => validateManifest({ entries: [{ name: "x", source: "a" }] })).toThrow();
  });

  it("rejects an absolute source path", () => {
    expect(() =>
      validateManifest({ entries: [{ name: "x", source: resolve("/etc/passwd"), target: "~/.x" }] })
    ).toThrow();
  });

  it("rejects duplicate entry names", () => {
    expect(() =>
      validateManifest({
        entries: [
          { name: "dup", source: "a", target: "~/.a" },
          { name: "dup", source: "b", target: "~/.b" },
        ],
      })
    ).toThrow();
  });

  it("rejects a non-boolean secret field", () => {
    expect(() =>
      validateManifest({ entries: [{ name: "x", source: "a", target: "~/.a", secret: "yes" }] })
    ).toThrow();
  });

  it("rejects two entries whose targets resolve to the same path", () => {
    expect(() =>
      validateManifest({
        entries: [
          { name: "a", source: "a", target: "~/.same" },
          { name: "b", source: "b", target: "~/.same" },
        ],
      })
    ).toThrow(/both resolve to the same target path/);
  });

  it("rejects same-target entries even when spelled differently (~ vs expanded absolute path)", () => {
    const expanded = join(homedir(), ".same");
    expect(() =>
      validateManifest({
        entries: [
          { name: "a", source: "a", target: "~/.same" },
          { name: "b", source: "b", target: expanded },
        ],
      })
    ).toThrow(/both resolve to the same target path/);
  });

  it("allows distinct entries that merely share a source", () => {
    // Linking the same repo file to two different locations is legitimate
    // (e.g. mirroring one config to two target paths) -- only duplicate
    // *targets* are a conflict, not duplicate sources.
    const manifest = validateManifest({
      entries: [
        { name: "a", source: "shared", target: "~/.a" },
        { name: "b", source: "shared", target: "~/.b" },
      ],
    });
    expect(manifest.entries).toHaveLength(2);
  });
});

describe("path helpers", () => {
  it("expands a leading ~ to the home directory", () => {
    expect(expandHome("~")).toBe(homedir());
    expect(expandHome("~/.bashrc")).toBe(join(homedir(), ".bashrc"));
  });

  it("leaves non-~ paths alone", () => {
    const abs = resolve("some", "path");
    expect(expandHome(abs)).toBe(abs);
  });

  it("resolveTargetPath expands ~ and returns an absolute path", () => {
    expect(resolveTargetPath("~/.zshrc")).toBe(join(homedir(), ".zshrc"));
  });

  it("resolveSourcePath resolves relative to the repo dir", () => {
    const repoDir = resolve("repo");
    expect(resolveSourcePath(repoDir, "git/gitconfig")).toBe(resolve(repoDir, "git/gitconfig"));
  });
});

describe("loadManifest (real files on disk)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "dotfiles-sync-manifest-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads and validates a manifest file from disk", () => {
    const manifestPath = join(dir, "dotfiles.json");
    writeFileSync(manifestPath, JSON.stringify({ entries: [{ name: "x", source: "x", target: "~/.x" }] }));
    const manifest = loadManifest(manifestPath);
    expect(manifest.entries[0]?.name).toBe("x");
  });

  it("throws a clear error for invalid JSON", () => {
    const manifestPath = join(dir, "dotfiles.json");
    writeFileSync(manifestPath, "{ not json");
    expect(() => loadManifest(manifestPath)).toThrow();
  });

  it("throws a clear error when the manifest file is missing", () => {
    expect(() => loadManifest(join(dir, "missing.json"))).toThrow();
  });
});

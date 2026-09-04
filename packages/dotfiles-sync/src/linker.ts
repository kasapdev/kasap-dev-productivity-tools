import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { decryptFile } from "./crypto.js";
import type { DotfileEntry } from "./manifest.js";
import { resolveSourcePath, resolveTargetPath } from "./manifest.js";

export type Logger = (message: string) => void;

const defaultLogger: Logger = (msg) => {
  console.log(msg);
};

export type EntryState = "linked" | "missing" | "diverged";

export interface EntryStatus {
  entry: DotfileEntry;
  state: EntryState;
  detail: string;
}

/** sha256 content hash of a file or a directory tree (name + content, recursive). */
export function hashPath(p: string): string {
  const stat = statSync(p);
  const hash = createHash("sha256");
  if (stat.isDirectory()) {
    const names = readdirSync(p).sort();
    for (const name of names) {
      hash.update(`d:${name}\n`);
      hash.update(hashPath(resolve(p, name)));
    }
  } else {
    hash.update("f:");
    hash.update(readFileSync(p));
  }
  return hash.digest("hex");
}

function normalizeForCompare(p: string): string {
  // Windows junction readlink() can return \\?\ prefixed absolute paths.
  let norm = p.replace(/^\\\\\?\\/, "");
  norm = resolve(norm);
  if (process.platform === "win32") norm = norm.toLowerCase();
  return norm;
}

/** If targetAbs is a symlink, return the absolute path it resolves to (normalized); else undefined. */
function currentSymlinkTarget(targetAbs: string): string | undefined {
  let lst;
  try {
    lst = lstatSync(targetAbs);
  } catch {
    return undefined;
  }
  if (!lst.isSymbolicLink()) return undefined;
  const raw = readlinkSync(targetAbs);
  const resolved = isAbsolute(raw) ? raw : resolve(dirname(targetAbs), raw);
  return normalizeForCompare(resolved);
}

function isEPERMLike(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === "EPERM" || code === "EACCES";
}

function backupExisting(targetAbs: string, log: Logger): void {
  let backupPath = `${targetAbs}.backup`;
  let n = 1;
  while (existsSync(backupPath)) {
    backupPath = `${targetAbs}.backup.${n}`;
    n += 1;
  }
  renameSync(targetAbs, backupPath);
  log(`[backup] existing file at ${targetAbs} moved to ${backupPath}`);
}

function copyPath(sourceAbs: string, targetAbs: string, isDir: boolean): void {
  if (isDir) {
    cpSync(sourceAbs, targetAbs, { recursive: true });
  } else {
    copyFileSync(sourceAbs, targetAbs);
  }
}

/**
 * Create a real link from targetAbs to sourceAbs.
 * - POSIX: fs.symlinkSync(source, target, 'file' | 'dir').
 * - Windows: directories use a 'junction' symlink (no admin rights required).
 *   Files attempt a real file symlink, which requires elevated privileges or
 *   Developer Mode. If that throws EPERM/EACCES, fall back to a real file
 *   copy and log a warning that a live symlink was NOT created.
 */
function createLink(sourceAbs: string, targetAbs: string, isDir: boolean, log: Logger): "symlink" | "copy" {
  if (process.platform === "win32") {
    try {
      symlinkSync(sourceAbs, targetAbs, isDir ? "junction" : "file");
      return "symlink";
    } catch (err) {
      if (!isEPERMLike(err)) throw err;
      log(
        `[warn] could not create a Windows symlink for "${targetAbs}" (requires admin rights or Developer Mode). ` +
          `Falling back to a real file copy -- this will NOT stay in sync automatically; re-run "link" after editing the repo copy.`
      );
      copyPath(sourceAbs, targetAbs, isDir);
      return "copy";
    }
  }
  symlinkSync(sourceAbs, targetAbs, isDir ? "dir" : "file");
  return "symlink";
}

function ensureParentDir(p: string): void {
  mkdirSync(dirname(p), { recursive: true });
}

/** Link a single non-secret manifest entry: real symlink (or Windows copy fallback). */
export function linkEntry(entry: DotfileEntry, repoDir: string, log: Logger = defaultLogger): void {
  const sourceAbs = resolveSourcePath(repoDir, entry.source);
  const targetAbs = resolveTargetPath(entry.target);

  if (!existsSync(sourceAbs)) {
    throw new Error(`[${entry.name}] source does not exist in repo: ${sourceAbs}`);
  }
  const isDir = statSync(sourceAbs).isDirectory();

  ensureParentDir(targetAbs);

  let lst;
  try {
    lst = lstatSync(targetAbs);
  } catch {
    lst = undefined;
  }

  if (lst) {
    if (lst.isSymbolicLink()) {
      const current = currentSymlinkTarget(targetAbs);
      if (current === normalizeForCompare(sourceAbs)) {
        log(`[${entry.name}] already linked -> ${sourceAbs}`);
        return;
      }
    } else {
      try {
        if (hashPath(targetAbs) === hashPath(sourceAbs)) {
          log(`[${entry.name}] already up to date (copy fallback)`);
          return;
        }
      } catch {
        // fall through to backup + relink
      }
    }
    backupExisting(targetAbs, log);
  }

  const mode = createLink(sourceAbs, targetAbs, isDir, log);
  log(`[${entry.name}] linked (${mode}) ${targetAbs} -> ${sourceAbs}`);
}

/** Decrypt a secret manifest entry's encrypted source into its plaintext target. */
export function linkSecretEntry(
  entry: DotfileEntry,
  repoDir: string,
  passphrase: string,
  log: Logger = defaultLogger
): void {
  const sourceAbs = resolveSourcePath(repoDir, entry.source);
  const targetAbs = resolveTargetPath(entry.target);

  if (!existsSync(sourceAbs)) {
    throw new Error(`[${entry.name}] encrypted source does not exist in repo: ${sourceAbs}`);
  }

  ensureParentDir(targetAbs);

  let lst;
  try {
    lst = lstatSync(targetAbs);
  } catch {
    lst = undefined;
  }

  const plaintext = decryptFile(sourceAbs, passphrase);

  if (lst) {
    if (!lst.isSymbolicLink()) {
      try {
        const existing = readFileSync(targetAbs);
        if (existing.equals(plaintext)) {
          log(`[${entry.name}] secret already up to date at ${targetAbs}`);
          return;
        }
      } catch {
        // fall through to backup + write
      }
    }
    backupExisting(targetAbs, log);
  }

  // Plaintext is written ONLY to the target (never back into the repo dir).
  writeFileSync(targetAbs, plaintext, { mode: 0o600 });
  log(`[${entry.name}] decrypted secret written to ${targetAbs}`);
}

/** Remove the managed target for a non-secret entry, but only if it looks like ours. */
export function unlinkEntry(entry: DotfileEntry, repoDir: string, log: Logger = defaultLogger): void {
  const sourceAbs = resolveSourcePath(repoDir, entry.source);
  const targetAbs = resolveTargetPath(entry.target);

  let lst;
  try {
    lst = lstatSync(targetAbs);
  } catch {
    log(`[${entry.name}] nothing to unlink, ${targetAbs} does not exist`);
    return;
  }

  if (lst.isSymbolicLink()) {
    const current = currentSymlinkTarget(targetAbs);
    if (current !== normalizeForCompare(sourceAbs)) {
      log(`[${entry.name}] refusing to remove ${targetAbs}: symlink points elsewhere`);
      return;
    }
    unlinkSync(targetAbs);
    log(`[${entry.name}] removed symlink ${targetAbs}`);
    return;
  }

  // Windows copy-fallback case: only remove if content still matches the repo source.
  if (!existsSync(sourceAbs)) {
    log(`[${entry.name}] refusing to remove ${targetAbs}: repo source is missing, cannot verify`);
    return;
  }
  try {
    if (hashPath(targetAbs) !== hashPath(sourceAbs)) {
      log(`[${entry.name}] refusing to remove ${targetAbs}: content diverged from repo source`);
      return;
    }
  } catch (err) {
    log(`[${entry.name}] refusing to remove ${targetAbs}: could not verify content (${(err as Error).message})`);
    return;
  }
  if (lst.isDirectory()) {
    rmSync(targetAbs, { recursive: true, force: true });
  } else {
    unlinkSync(targetAbs);
  }
  log(`[${entry.name}] removed copy ${targetAbs}`);
}

/** Remove the decrypted plaintext target for a secret entry, if it matches the encrypted source. */
export function unlinkSecretEntry(
  entry: DotfileEntry,
  repoDir: string,
  passphrase: string | undefined,
  log: Logger = defaultLogger
): void {
  const sourceAbs = resolveSourcePath(repoDir, entry.source);
  const targetAbs = resolveTargetPath(entry.target);

  if (!existsSync(targetAbs)) {
    log(`[${entry.name}] nothing to unlink, ${targetAbs} does not exist`);
    return;
  }
  if (!passphrase) {
    log(`[${entry.name}] refusing to remove ${targetAbs}: no passphrase available to verify it matches the secret`);
    return;
  }
  if (!existsSync(sourceAbs)) {
    log(`[${entry.name}] refusing to remove ${targetAbs}: encrypted repo source is missing, cannot verify`);
    return;
  }
  try {
    const plaintext = decryptFile(sourceAbs, passphrase);
    const existing = readFileSync(targetAbs);
    if (!existing.equals(plaintext)) {
      log(`[${entry.name}] refusing to remove ${targetAbs}: content diverged from decrypted secret`);
      return;
    }
  } catch (err) {
    log(`[${entry.name}] refusing to remove ${targetAbs}: could not verify content (${(err as Error).message})`);
    return;
  }
  unlinkSync(targetAbs);
  log(`[${entry.name}] removed decrypted secret ${targetAbs}`);
}

export function statusEntry(entry: DotfileEntry, repoDir: string): EntryStatus {
  if (entry.secret === true) {
    return statusSecretEntry(entry, repoDir);
  }

  const sourceAbs = resolveSourcePath(repoDir, entry.source);
  const targetAbs = resolveTargetPath(entry.target);

  if (!existsSync(sourceAbs)) {
    return { entry, state: "missing", detail: `source missing in repo: ${sourceAbs}` };
  }

  let lst;
  try {
    lst = lstatSync(targetAbs);
  } catch {
    return { entry, state: "missing", detail: `target does not exist: ${targetAbs}` };
  }

  if (lst.isSymbolicLink()) {
    const current = currentSymlinkTarget(targetAbs);
    const expected = normalizeForCompare(sourceAbs);
    if (current === expected) {
      return { entry, state: "linked", detail: "symlink points at repo source" };
    }
    return { entry, state: "diverged", detail: `symlink points elsewhere (${current ?? "unresolved"})` };
  }

  try {
    const same = hashPath(sourceAbs) === hashPath(targetAbs);
    if (same) {
      return { entry, state: "linked", detail: "copy (no live symlink) matches source content" };
    }
    return { entry, state: "diverged", detail: "target content differs from repo source" };
  } catch (err) {
    return { entry, state: "diverged", detail: `could not compare content: ${(err as Error).message}` };
  }
}

function statusSecretEntry(entry: DotfileEntry, repoDir: string): EntryStatus {
  const sourceAbs = resolveSourcePath(repoDir, entry.source);
  const targetAbs = resolveTargetPath(entry.target);

  if (!existsSync(sourceAbs)) {
    return { entry, state: "missing", detail: "encrypted source missing in repo" };
  }
  if (!existsSync(targetAbs)) {
    return { entry, state: "missing", detail: 'encrypted source present, target not decrypted yet (run "link")' };
  }

  const passphrase = process.env.DOTFILES_SYNC_PASSPHRASE;
  if (!passphrase) {
    return {
      entry,
      state: "linked",
      detail: "target present (set DOTFILES_SYNC_PASSPHRASE to verify content matches the secret)",
    };
  }

  try {
    const plaintext = decryptFile(sourceAbs, passphrase);
    const existing = readFileSync(targetAbs);
    if (existing.equals(plaintext)) {
      return { entry, state: "linked", detail: "decrypted target is up to date" };
    }
    return { entry, state: "diverged", detail: "target content differs from decrypted secret" };
  } catch (err) {
    return { entry, state: "diverged", detail: `could not verify secret: ${(err as Error).message}` };
  }
}

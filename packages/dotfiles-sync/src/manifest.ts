import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export interface DotfileEntry {
  /** Human-readable identifier, must be unique within the manifest. */
  name: string;
  /**
   * Path to the source file/dir inside the repo dir, relative to the repo dir.
   * For secret entries, this is the path to the encrypted envelope (e.g. "ssh/id_ed25519.enc").
   */
  source: string;
  /** Absolute path, or ~-relative path, of where this dotfile should live. */
  target: string;
  /** If true, `source` holds an AES-256-GCM encrypted envelope, not plaintext. */
  secret?: boolean;
}

export interface Manifest {
  entries: DotfileEntry[];
}

export function defaultRepoDir(): string {
  return join(homedir(), ".dotfiles");
}

export function defaultManifestPath(repoDir?: string): string {
  return join(repoDir ?? defaultRepoDir(), "dotfiles.json");
}

/** Expand a leading "~" (or "~/", "~\\") to the current user's home directory. */
export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

export function resolveTargetPath(target: string): string {
  return resolve(expandHome(target));
}

export function resolveSourcePath(repoDir: string, source: string): string {
  return resolve(repoDir, source);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/**
 * Normalize a manifest `target` for duplicate detection: resolve `~` and
 * relative paths the same way `resolveTargetPath` does, then case-fold on
 * Windows (whose filesystem is normally case-insensitive), mirroring
 * `normalizeForCompare` in linker.ts.
 */
function normalizeTargetForDedup(target: string): string {
  const resolved = resolveTargetPath(target);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** Validate an arbitrary parsed-JSON value as a Manifest, throwing a descriptive error otherwise. */
export function validateManifest(data: unknown): Manifest {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error('Manifest must be a JSON object of the form { "entries": [ ... ] }');
  }
  const raw = data as Record<string, unknown>;
  const entriesRaw = raw.entries;
  if (!Array.isArray(entriesRaw)) {
    throw new Error('Manifest must have an "entries" array');
  }

  const seen = new Set<string>();
  const seenTargets = new Map<string, string>();
  const entries: DotfileEntry[] = entriesRaw.map((item, index) => {
    if (item === null || typeof item !== "object") {
      throw new Error(`entries[${index}] must be an object`);
    }
    const e = item as Record<string, unknown>;

    if (!isNonEmptyString(e.name)) {
      throw new Error(`entries[${index}].name must be a non-empty string`);
    }
    if (!isNonEmptyString(e.source)) {
      throw new Error(`entries[${index}] ("${e.name}").source must be a non-empty string`);
    }
    if (!isNonEmptyString(e.target)) {
      throw new Error(`entries[${index}] ("${e.name}").target must be a non-empty string`);
    }
    if (isAbsolute(e.source)) {
      throw new Error(
        `entries[${index}] ("${e.name}").source must be relative to the repo dir, got an absolute path: "${e.source}"`
      );
    }
    if (e.secret !== undefined && typeof e.secret !== "boolean") {
      throw new Error(`entries[${index}] ("${e.name}").secret must be a boolean if present`);
    }
    if (seen.has(e.name)) {
      throw new Error(`Duplicate manifest entry name: "${e.name}"`);
    }
    seen.add(e.name);

    // Two entries resolving to the same target would fight over it: each
    // `link` run would see the other's symlink/copy as "diverged", back it
    // up, and relink to itself -- silently piling up a fresh
    // `target.backup.N` file every time the tool runs. Catch this at load
    // time instead, comparing resolved (not raw) paths so "~/.foo" and its
    // expanded absolute equivalent are still recognized as the same target.
    const normalizedTarget = normalizeTargetForDedup(e.target);
    const conflictingName = seenTargets.get(normalizedTarget);
    if (conflictingName !== undefined) {
      throw new Error(
        `entries "${conflictingName}" and "${e.name}" both resolve to the same target path ` +
          `("${resolveTargetPath(e.target)}"); each manifest entry must have a unique target`
      );
    }
    seenTargets.set(normalizedTarget, e.name);

    return {
      name: e.name,
      source: e.source,
      target: e.target,
      secret: e.secret === true,
    };
  });

  return { entries };
}

export function loadManifest(manifestPath: string): Manifest {
  let raw: string;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch (err) {
    throw new Error(`Could not read manifest at ${manifestPath}: ${(err as Error).message}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Manifest at ${manifestPath} is not valid JSON: ${(err as Error).message}`);
  }
  return validateManifest(data);
}

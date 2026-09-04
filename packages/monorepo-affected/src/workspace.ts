import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";

export interface PackageNode {
  /** The package's `name` field from package.json. */
  name: string;
  /** Absolute path to the package directory. */
  dir: string;
  /** Names of other discovered workspace packages this package depends on. */
  dependencies: string[];
}

interface RawPackageJson {
  name?: unknown;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  peerDependencies?: Record<string, unknown>;
  scripts?: Record<string, unknown>;
}

/**
 * Determine the workspace package globs for a monorepo root.
 *
 * Preference order:
 *   1. `pnpm-workspace.yaml`'s `packages:` array, if the file exists.
 *   2. The root `package.json`'s `workspaces` field, supporting both the
 *      array form (`["packages/*"]`) and the object form
 *      (`{ "packages": ["packages/*"] }`).
 *   3. Empty array if neither is present.
 */
export function getWorkspaceGlobs(root: string): string[] {
  const pnpmWorkspacePath = path.join(root, "pnpm-workspace.yaml");
  if (fs.existsSync(pnpmWorkspacePath)) {
    const contents = fs.readFileSync(pnpmWorkspacePath, "utf8");
    const doc = parseYaml(contents) as { packages?: unknown } | null | undefined;
    const packages = doc?.packages;
    if (Array.isArray(packages)) {
      const globs = packages.filter((p): p is string => typeof p === "string");
      if (globs.length > 0) return globs;
    }
  }

  const pkgJsonPath = path.join(root, "package.json");
  if (fs.existsSync(pkgJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as {
      workspaces?: unknown;
    };
    const workspaces = pkg.workspaces;
    if (Array.isArray(workspaces)) {
      return workspaces.filter((p): p is string => typeof p === "string");
    }
    if (
      workspaces &&
      typeof workspaces === "object" &&
      Array.isArray((workspaces as { packages?: unknown }).packages)
    ) {
      return (workspaces as { packages: unknown[] }).packages.filter(
        (p): p is string => typeof p === "string",
      );
    }
  }

  return [];
}

function hasPackageJson(dir: string): boolean {
  return fs.existsSync(path.join(dir, "package.json"));
}

/**
 * Resolve a single workspace glob to a list of absolute package directories.
 *
 * Supports the common `"dir/*"` single-star pattern (list subdirectories of
 * `dir` that contain a package.json) as well as literal directory entries
 * without a `*` (e.g. `"apps/web"`). Other glob shapes are not supported and
 * resolve to an empty list rather than throwing.
 */
export function resolveGlob(root: string, pattern: string): string[] {
  const normalized = pattern.replace(/\\/g, "/");

  if (!normalized.includes("*")) {
    const dir = path.join(root, normalized);
    return hasPackageJson(dir) ? [dir] : [];
  }

  const starIndex = normalized.indexOf("*");
  const prefix = normalized.slice(0, starIndex).replace(/\/$/, "");
  const suffix = normalized.slice(starIndex + 1);

  // Only the trailing "/*" shape (a single star as the final path segment)
  // is supported; anything else (nested globs, mid-path stars) is skipped.
  if (suffix !== "" && suffix !== "/") {
    return [];
  }

  const baseDir = path.join(root, prefix);
  if (!fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory()) {
    return [];
  }

  return fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(baseDir, entry.name))
    .filter(hasPackageJson);
}

/**
 * Discover all workspace packages under `root` and build the dependency
 * graph node list. An edge is recorded from package A to package B ("A
 * depends on B") when, in A's dependencies/devDependencies/peerDependencies:
 *   - the value starts with `workspace:` or `file:`, OR
 *   - the key exactly matches another discovered workspace package's name
 *     (regardless of the version specifier value).
 */
export function discoverWorkspace(root: string): PackageNode[] {
  const globs = getWorkspaceGlobs(root);
  const dirs = Array.from(
    new Set(globs.flatMap((glob) => resolveGlob(root, glob))),
  );

  const raw: { dir: string; name: string; pkg: RawPackageJson }[] = [];
  for (const dir of dirs) {
    const pkgPath = path.join(dir, "package.json");
    if (!fs.existsSync(pkgPath)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as RawPackageJson;
    if (typeof pkg.name !== "string" || pkg.name.length === 0) continue;
    raw.push({ dir, name: pkg.name, pkg });
  }

  const allNames = new Set(raw.map((entry) => entry.name));

  return raw.map(({ dir, name, pkg }) => {
    const deps = new Set<string>();
    const sections = [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies];
    for (const section of sections) {
      if (!section) continue;
      for (const [depName, spec] of Object.entries(section)) {
        if (depName === name) continue;
        const isWorkspaceProtocol =
          typeof spec === "string" &&
          (spec.startsWith("workspace:") || spec.startsWith("file:"));
        const isNameMatch = allNames.has(depName);
        if (isWorkspaceProtocol || isNameMatch) {
          deps.add(depName);
        }
      }
    }
    return { name, dir, dependencies: Array.from(deps) };
  });
}

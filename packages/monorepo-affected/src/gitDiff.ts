import { execFileSync } from "node:child_process";
import * as path from "node:path";
import type { PackageNode } from "./workspace.js";

function stripQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Parse `git status --porcelain` output into a list of changed file paths
 * (relative to the repo root, posix-separated, as git reports them).
 * Handles the standard "XY path" shape and the rename "XY old -> new" shape
 * (the new path is used for renames).
 */
export function parsePorcelainStatus(output: string): string[] {
  const files: string[] = [];
  for (const rawLine of output.split("\n")) {
    if (rawLine.length === 0) continue;
    // Porcelain lines are "XY <path>" — two status chars, a space, then path.
    const rest = rawLine.slice(3);
    if (rest.length === 0) continue;
    const arrowIndex = rest.indexOf(" -> ");
    const filePath = arrowIndex >= 0 ? rest.slice(arrowIndex + 4) : rest;
    files.push(stripQuotes(filePath.trim()));
  }
  return files;
}

/** Parse `git diff --name-only` output into a list of changed file paths. */
export function parseNameOnlyDiff(output: string): string[] {
  return output
    .split("\n")
    .map((line) => stripQuotes(line.trim()))
    .filter((line) => line.length > 0);
}

/** Run `git status --porcelain` in `root` and return the changed file paths. */
export function getStatusChangedFiles(root: string): string[] {
  const output = execFileSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  });
  return parsePorcelainStatus(output);
}

/**
 * Run `git diff --name-only <from> <to>` in `root` and return the changed
 * file paths.
 */
export function getDiffChangedFiles(root: string, from: string, to: string): string[] {
  const output = execFileSync("git", ["diff", "--name-only", from, to], {
    cwd: root,
    encoding: "utf8",
  });
  return parseNameOnlyDiff(output);
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/**
 * Map a set of changed file paths (relative to `root`, as reported by git)
 * to the workspace packages whose directory contains them, via
 * longest-prefix match. Files that fall outside every package directory
 * (e.g. at the monorepo root) are dropped.
 */
export function mapFilesToPackages(
  files: string[],
  nodes: PackageNode[],
  root: string,
): Set<string> {
  const candidates = nodes.map((node) => ({
    name: node.name,
    relDir: toPosix(path.relative(root, node.dir)),
  }));

  const result = new Set<string>();
  for (const file of files) {
    const normalizedFile = toPosix(file);
    let best: { name: string; relDir: string } | undefined;
    for (const candidate of candidates) {
      const isMatch =
        normalizedFile === candidate.relDir ||
        normalizedFile.startsWith(`${candidate.relDir}/`);
      if (isMatch && (!best || candidate.relDir.length > best.relDir.length)) {
        best = candidate;
      }
    }
    if (best) result.add(best.name);
  }
  return result;
}

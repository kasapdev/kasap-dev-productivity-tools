import { execFileSync } from "node:child_process";

/**
 * Thin wrappers around real git plumbing commands.
 *
 * IMPORTANT: nothing in this file ever mutates the repository. Every
 * function here only *reads* git state (for-each-ref, branch --merged,
 * log, show-ref). Deletion commands are only ever written to a shell
 * script for the human to review and run manually — see scriptGen.ts.
 */

export interface BranchList {
  /** Local branch names, e.g. "main", "feature/foo" */
  local: string[];
  /** Remote-tracking branch names, e.g. "origin/main", "origin/feature/foo" */
  remote: string[];
}

export interface MergedBranches {
  local: Set<string>;
  remote: Set<string>;
}

function runGit(repoPath: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoPath,
    encoding: "utf8",
  }).trim();
}

/**
 * Checks whether a local branch exists using real git plumbing
 * (git show-ref --verify --quiet refs/heads/<name>).
 */
export function branchExistsLocally(repoPath: string, name: string): boolean {
  try {
    execFileSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${name}`], {
      cwd: repoPath,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Determines the main/base branch to use: the preferred name if it
 * exists locally, otherwise falls back to "master" if the preferred
 * name was the default "main" and "master" exists locally instead.
 */
export function detectMainBranch(repoPath: string, preferred = "main"): string {
  if (branchExistsLocally(repoPath, preferred)) {
    return preferred;
  }
  if (preferred === "main" && branchExistsLocally(repoPath, "master")) {
    return "master";
  }
  throw new Error(
    `Could not find branch "${preferred}" (or fallback "master") in repo at ${repoPath}`,
  );
}

/**
 * Lists all local branches (refs/heads) and remote-tracking branches
 * (refs/remotes/origin), excluding the symbolic origin/HEAD ref.
 */
export function listBranches(repoPath: string): BranchList {
  const localOut = runGit(repoPath, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
  const local = localOut
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const remoteOut = runGit(repoPath, [
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/remotes/origin",
  ]);
  const remote = remoteOut
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((name) => name !== "origin/HEAD");

  return { local, remote };
}

function parseMergedBranchOutput(output: string): Set<string> {
  const names = new Set<string>();
  for (const rawLine of output.split("\n")) {
    let line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    // Strip the "* " / "+ " current-branch/worktree markers git prints.
    if (line.startsWith("* ") || line.startsWith("+ ")) {
      line = line.slice(2).trim();
    }
    // Symbolic refs like "origin/HEAD -> origin/main" - keep the ref name
    // before the arrow, but we filter origin/HEAD out entirely below.
    const arrowIndex = line.indexOf(" -> ");
    if (arrowIndex !== -1) {
      line = line.slice(0, arrowIndex).trim();
    }
    if (line.length === 0 || line === "origin/HEAD") {
      continue;
    }
    names.add(line);
  }
  return names;
}

/**
 * Determines which local and remote-tracking branches are merged into
 * mainBranch, via `git branch --merged <main>` and `git branch -r --merged <main>`.
 */
export function getMergedBranches(repoPath: string, mainBranch: string): MergedBranches {
  const localOut = runGit(repoPath, ["branch", "--merged", mainBranch]);
  const remoteOut = runGit(repoPath, ["branch", "-r", "--merged", mainBranch]);
  return {
    local: parseMergedBranchOutput(localOut),
    remote: parseMergedBranchOutput(remoteOut),
  };
}

/**
 * Returns the Unix timestamp (seconds) of the last commit on the given
 * branch, via `git log -1 --format=%ct <branch>`.
 */
export function getLastCommitTimestamp(repoPath: string, branch: string): number {
  const out = runGit(repoPath, ["log", "-1", "--format=%ct", branch]);
  const timestamp = Number.parseInt(out, 10);
  if (!out || Number.isNaN(timestamp)) {
    throw new Error(`Could not determine last commit timestamp for branch "${branch}"`);
  }
  return timestamp;
}

/**
 * Converts a Unix timestamp (seconds) into "days since" relative to now.
 */
export function daysSince(unixSeconds: number): number {
  return (Date.now() / 1000 - unixSeconds) / 86400;
}

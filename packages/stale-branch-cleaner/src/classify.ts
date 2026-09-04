import {
  daysSince,
  detectMainBranch,
  getLastCommitTimestamp,
  getMergedBranches,
  listBranches,
} from "./git.js";

export interface Thresholds {
  mergedThresholdDays: number;
  unmergedThresholdDays: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  mergedThresholdDays: 30,
  unmergedThresholdDays: 90,
};

export interface BranchClassificationInput {
  name: string;
  merged: boolean;
  daysSinceLastCommit: number;
}

export interface BranchClassificationResult {
  stale: boolean;
}

/**
 * Pure classification logic, no I/O.
 *
 * A branch is stale if:
 *   - it is merged into main AND it has not been committed to in more
 *     than `mergedThresholdDays` days, OR
 *   - it is NOT merged into main AND it has not been committed to in
 *     more than `unmergedThresholdDays` days.
 *
 * The comparison is strictly greater-than: a branch exactly at the
 * threshold (e.g. exactly 30.0 days for a merged branch) is NOT stale.
 */
export function classifyBranch(
  input: BranchClassificationInput,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): BranchClassificationResult {
  const threshold = input.merged ? thresholds.mergedThresholdDays : thresholds.unmergedThresholdDays;
  return { stale: input.daysSinceLastCommit > threshold };
}

export interface BranchReportEntry {
  name: string;
  isRemote: boolean;
  merged: boolean;
  daysSinceLastCommit: number;
  stale: boolean;
}

export interface BuildReportOptions {
  repoPath: string;
  mainBranchPreference?: string;
  thresholds?: Thresholds;
}

export interface BuildReportResult {
  mainBranch: string;
  entries: BranchReportEntry[];
}

/**
 * Assembles the full per-branch report by combining the real git
 * primitives in git.ts with the pure classifyBranch() logic above.
 */
export function buildReport(options: BuildReportOptions): BuildReportResult {
  const { repoPath } = options;
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  const mainBranch = detectMainBranch(repoPath, options.mainBranchPreference ?? "main");

  const { local, remote } = listBranches(repoPath);
  const merged = getMergedBranches(repoPath, mainBranch);

  const entries: BranchReportEntry[] = [];

  for (const name of local) {
    if (name === mainBranch) {
      continue;
    }
    const timestamp = getLastCommitTimestamp(repoPath, name);
    const daysSinceLastCommit = daysSince(timestamp);
    const isMerged = merged.local.has(name);
    const { stale } = classifyBranch({ name, merged: isMerged, daysSinceLastCommit }, thresholds);
    entries.push({ name, isRemote: false, merged: isMerged, daysSinceLastCommit, stale });
  }

  const mainRemoteRef = `origin/${mainBranch}`;
  for (const name of remote) {
    if (name === mainRemoteRef) {
      continue;
    }
    const timestamp = getLastCommitTimestamp(repoPath, name);
    const daysSinceLastCommit = daysSince(timestamp);
    const isMerged = merged.remote.has(name);
    const { stale } = classifyBranch({ name, merged: isMerged, daysSinceLastCommit }, thresholds);
    entries.push({ name, isRemote: true, merged: isMerged, daysSinceLastCommit, stale });
  }

  return { mainBranch, entries };
}

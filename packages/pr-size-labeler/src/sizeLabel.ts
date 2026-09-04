import { minimatch } from "minimatch";

/** A minimal shape of a GitHub PR "files" API entry that we care about. */
export interface ChangedFile {
  filename: string;
  additions: number;
  deletions: number;
}

/** Thresholds (exclusive upper bounds) used to map a changed-line count to a size label. */
export interface SizeThresholds {
  xsMax: number;
  sMax: number;
  mMax: number;
  lMax: number;
}

export const DEFAULT_EXCLUDE_PATTERNS: readonly string[] = [
  "**/pnpm-lock.yaml",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/*.lock",
  "dist/**",
  "**/*.min.js",
];

export const DEFAULT_SIZE_THRESHOLDS: SizeThresholds = {
  xsMax: 10,
  sMax: 50,
  mMax: 250,
  lMax: 1000,
};

/**
 * Sums additions + deletions across all files, excluding any file whose path
 * matches one of the given glob patterns (matched with minimatch, with
 * `dot: true` so dotfiles are matched by patterns like `**\/*` as expected).
 */
export function computeTotalChangedLines(
  files: readonly ChangedFile[],
  excludePatterns: readonly string[],
): number {
  let total = 0;
  for (const file of files) {
    const excluded = excludePatterns.some((pattern) =>
      minimatch(file.filename, pattern, { dot: true }),
    );
    if (excluded) {
      continue;
    }
    total += file.additions + file.deletions;
  }
  return total;
}

/**
 * Maps a total changed-line count to a size label using exclusive upper
 * bounds: `total < xsMax` -> size/XS, `total < sMax` -> size/S, and so on.
 * A total that is >= lMax falls into size/XL.
 */
export function computeSizeLabel(
  totalChangedLines: number,
  thresholds: SizeThresholds,
): string {
  if (totalChangedLines < thresholds.xsMax) {
    return "size/XS";
  }
  if (totalChangedLines < thresholds.sMax) {
    return "size/S";
  }
  if (totalChangedLines < thresholds.mMax) {
    return "size/M";
  }
  if (totalChangedLines < thresholds.lMax) {
    return "size/L";
  }
  return "size/XL";
}

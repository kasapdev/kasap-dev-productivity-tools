import { describe, expect, it } from "vitest";
import { classifyBranch, DEFAULT_THRESHOLDS } from "../src/classify.js";

describe("classifyBranch", () => {
  it("flags a merged branch that is older than the merged threshold as stale", () => {
    const result = classifyBranch(
      { name: "old-feature", merged: true, daysSinceLastCommit: 45 },
      DEFAULT_THRESHOLDS,
    );
    expect(result.stale).toBe(true);
  });

  it("does not flag a merged branch that was committed to recently", () => {
    const result = classifyBranch(
      { name: "recent-feature", merged: true, daysSinceLastCommit: 5 },
      DEFAULT_THRESHOLDS,
    );
    expect(result.stale).toBe(false);
  });

  it("flags an unmerged branch older than the (larger) unmerged threshold as stale", () => {
    const result = classifyBranch(
      { name: "abandoned-wip", merged: false, daysSinceLastCommit: 120 },
      DEFAULT_THRESHOLDS,
    );
    expect(result.stale).toBe(true);
  });

  it("does NOT flag an unmerged branch that is moderately old (over the merged threshold but under the unmerged threshold)", () => {
    // 40 days: > mergedThresholdDays (30) but < unmergedThresholdDays (90).
    // Unmerged branches get a larger threshold since they might still be
    // active work, so this must NOT be flagged stale.
    const result = classifyBranch(
      { name: "in-progress", merged: false, daysSinceLastCommit: 40 },
      DEFAULT_THRESHOLDS,
    );
    expect(result.stale).toBe(false);
  });

  it("flags a very old unmerged branch as stale", () => {
    const result = classifyBranch(
      { name: "very-stale-wip", merged: false, daysSinceLastCommit: 400 },
      DEFAULT_THRESHOLDS,
    );
    expect(result.stale).toBe(true);
  });

  it("does not flag a merged branch exactly at the threshold (strictly greater-than)", () => {
    const result = classifyBranch(
      { name: "exactly-30", merged: true, daysSinceLastCommit: 30 },
      DEFAULT_THRESHOLDS,
    );
    expect(result.stale).toBe(false);
  });

  it("flags a merged branch just over the threshold", () => {
    const result = classifyBranch(
      { name: "just-over-30", merged: true, daysSinceLastCommit: 30.0001 },
      DEFAULT_THRESHOLDS,
    );
    expect(result.stale).toBe(true);
  });

  it("does not flag an unmerged branch exactly at its threshold (strictly greater-than)", () => {
    const result = classifyBranch(
      { name: "exactly-90", merged: false, daysSinceLastCommit: 90 },
      DEFAULT_THRESHOLDS,
    );
    expect(result.stale).toBe(false);
  });

  it("flags an unmerged branch just over its threshold", () => {
    const result = classifyBranch(
      { name: "just-over-90", merged: false, daysSinceLastCommit: 90.0001 },
      DEFAULT_THRESHOLDS,
    );
    expect(result.stale).toBe(true);
  });

  it("honors custom thresholds", () => {
    const custom = { mergedThresholdDays: 10, unmergedThresholdDays: 20 };
    expect(classifyBranch({ name: "a", merged: true, daysSinceLastCommit: 15 }, custom).stale).toBe(
      true,
    );
    expect(classifyBranch({ name: "b", merged: false, daysSinceLastCommit: 15 }, custom).stale).toBe(
      false,
    );
  });
});

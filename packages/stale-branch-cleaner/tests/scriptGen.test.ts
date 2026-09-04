import { describe, expect, it } from "vitest";
import type { BranchReportEntry } from "../src/classify.js";
import { generateDeleteScript } from "../src/scriptGen.js";

function entry(overrides: Partial<BranchReportEntry>): BranchReportEntry {
  return {
    name: "placeholder",
    isRemote: false,
    merged: true,
    daysSinceLastCommit: 45,
    stale: true,
    ...overrides,
  };
}

describe("generateDeleteScript", () => {
  it("starts with a bash shebang and set -euo pipefail", () => {
    const script = generateDeleteScript([]);
    const lines = script.split("\n");
    expect(lines[0]).toBe("#!/usr/bin/env bash");
    expect(lines[1]).toBe("set -euo pipefail");
  });

  it("never emits a real delete command when there are no flagged branches", () => {
    const script = generateDeleteScript([]);
    expect(script).not.toMatch(/^git branch -[dD]/m);
    expect(script).not.toMatch(/^git push origin --delete/m);
  });

  it("emits `git branch -d <name>` for a flagged local branch", () => {
    const script = generateDeleteScript([
      entry({ name: "old-local-feature", isRemote: false, merged: true, daysSinceLastCommit: 45 }),
    ]);
    expect(script).toContain("git branch -d old-local-feature");
    expect(script).not.toContain("git branch -D old-local-feature");
  });

  it("emits `git push origin --delete <name>` with the origin/ prefix stripped for a flagged remote branch", () => {
    const script = generateDeleteScript([
      entry({ name: "origin/old-remote-feature", isRemote: true, merged: true, daysSinceLastCommit: 60 }),
    ]);
    expect(script).toContain("git push origin --delete old-remote-feature");
    // must not push-delete with the origin/ prefix still attached
    expect(script).not.toContain("git push origin --delete origin/old-remote-feature");
  });

  it("includes a comment noting merged status and days since last commit for each branch", () => {
    const script = generateDeleteScript([
      entry({ name: "wip-branch", isRemote: false, merged: false, daysSinceLastCommit: 120 }),
    ]);
    expect(script).toMatch(/# wip-branch - NOT merged into main, 120\.0 days since last commit/);
  });

  it("handles a mix of local and remote-tracking flagged branches and only emits lines for those branches", () => {
    const branches = [
      entry({ name: "local-a", isRemote: false, merged: true, daysSinceLastCommit: 31 }),
      entry({ name: "origin/remote-b", isRemote: true, merged: false, daysSinceLastCommit: 91 }),
      entry({ name: "local-c", isRemote: false, merged: false, daysSinceLastCommit: 200 }),
    ];
    const script = generateDeleteScript(branches);

    expect(script).toContain("git branch -d local-a");
    expect(script).toContain("git push origin --delete remote-b");
    expect(script).toContain("git branch -d local-c");

    // sanity: exactly one branch/push-delete command per flagged branch
    const branchDeleteLines = script.split("\n").filter((l) => l.startsWith("git branch -d "));
    const pushDeleteLines = script.split("\n").filter((l) => l.startsWith("git push origin --delete "));
    expect(branchDeleteLines).toHaveLength(2);
    expect(pushDeleteLines).toHaveLength(1);
  });

  it("does not include a delete line for a branch that was not passed in (i.e. not flagged)", () => {
    const script = generateDeleteScript([
      entry({ name: "flagged-branch", isRemote: false, merged: true, daysSinceLastCommit: 45 }),
    ]);
    expect(script).not.toContain("git branch -d not-flagged-branch");
    expect(script).not.toContain("safe-branch");
  });

  it("notes that force-deleting an unmerged branch requires manually switching -d to -D", () => {
    const script = generateDeleteScript([]);
    expect(script).toMatch(/manually change.*-d.*to.*-D/i);
  });
});

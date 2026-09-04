import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

import {
  branchExistsLocally,
  detectMainBranch,
  getLastCommitTimestamp,
  getMergedBranches,
  listBranches,
} from "../src/git.js";

const mockedExecFileSync = vi.mocked(execFileSync);

describe("git.ts wrappers (execFileSync mocked)", () => {
  beforeEach(() => {
    mockedExecFileSync.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("listBranches", () => {
    it("parses local and remote branch names from for-each-ref output, excluding origin/HEAD", () => {
      mockedExecFileSync.mockImplementation((_cmd, args) => {
        const argList = args as string[];
        if (argList.includes("refs/heads")) {
          return "main\nfeature/foo\nbugfix/bar\n";
        }
        if (argList.includes("refs/remotes/origin")) {
          return "origin/HEAD\norigin/main\norigin/feature/foo\norigin/old-thing\n";
        }
        throw new Error(`unexpected args: ${argList.join(" ")}`);
      });

      const result = listBranches("/repo");

      expect(result.local).toEqual(["main", "feature/foo", "bugfix/bar"]);
      expect(result.remote).toEqual(["origin/main", "origin/feature/foo", "origin/old-thing"]);
      expect(result.remote).not.toContain("origin/HEAD");
    });

    it("returns empty arrays when there is no output", () => {
      mockedExecFileSync.mockReturnValue("");
      const result = listBranches("/repo");
      expect(result.local).toEqual([]);
      expect(result.remote).toEqual([]);
    });
  });

  describe("getMergedBranches", () => {
    it("parses `git branch --merged` output, stripping the '* ' current-branch marker", () => {
      mockedExecFileSync.mockImplementation((_cmd, args) => {
        const argList = args as string[];
        if (argList[0] === "branch" && !argList.includes("-r")) {
          return "  bugfix/bar\n* main\n  merged-feature\n";
        }
        if (argList[0] === "branch" && argList.includes("-r")) {
          return "  origin/merged-feature\n  origin/HEAD -> origin/main\n  origin/main\n";
        }
        throw new Error(`unexpected args: ${argList.join(" ")}`);
      });

      const result = getMergedBranches("/repo", "main");

      expect(result.local.has("bugfix/bar")).toBe(true);
      expect(result.local.has("merged-feature")).toBe(true);
      expect(result.local.has("main")).toBe(true);

      expect(result.remote.has("origin/merged-feature")).toBe(true);
      expect(result.remote.has("origin/main")).toBe(true);
      // symbolic origin/HEAD ref should never show up as a "merged branch" itself
      expect(result.remote.has("origin/HEAD")).toBe(false);
    });

    it("returns empty sets when nothing is merged", () => {
      mockedExecFileSync.mockReturnValue("");
      const result = getMergedBranches("/repo", "main");
      expect(result.local.size).toBe(0);
      expect(result.remote.size).toBe(0);
    });
  });

  describe("getLastCommitTimestamp", () => {
    it("parses the Unix timestamp printed by `git log -1 --format=%ct <branch>`", () => {
      const fortyDaysAgo = Math.floor(Date.now() / 1000) - 40 * 86400;
      mockedExecFileSync.mockReturnValue(`${fortyDaysAgo}\n`);

      const result = getLastCommitTimestamp("/repo", "feature/foo");

      expect(result).toBe(fortyDaysAgo);
      expect(mockedExecFileSync).toHaveBeenCalledWith(
        "git",
        ["log", "-1", "--format=%ct", "feature/foo"],
        expect.objectContaining({ cwd: "/repo" }),
      );
    });

    it("throws a clear error when git produces no usable output", () => {
      mockedExecFileSync.mockReturnValue("");
      expect(() => getLastCommitTimestamp("/repo", "ghost-branch")).toThrowError(/ghost-branch/);
    });
  });

  describe("branchExistsLocally / detectMainBranch", () => {
    it("returns true when show-ref succeeds and false when it throws", () => {
      mockedExecFileSync.mockImplementation((_cmd, args) => {
        const argList = args as string[];
        if (argList.includes("refs/heads/main")) {
          return "";
        }
        throw Object.assign(new Error("not a valid ref"), { status: 1 });
      });

      expect(branchExistsLocally("/repo", "main")).toBe(true);
      expect(branchExistsLocally("/repo", "does-not-exist")).toBe(false);
    });

    it("detects 'main' directly when it exists", () => {
      mockedExecFileSync.mockImplementation((_cmd, args) => {
        const argList = args as string[];
        if (argList.includes("refs/heads/main")) {
          return "";
        }
        throw new Error("not found");
      });

      expect(detectMainBranch("/repo", "main")).toBe("main");
    });

    it("falls back to 'master' when the default 'main' does not exist", () => {
      mockedExecFileSync.mockImplementation((_cmd, args) => {
        const argList = args as string[];
        if (argList.includes("refs/heads/master")) {
          return "";
        }
        throw new Error("not found");
      });

      expect(detectMainBranch("/repo", "main")).toBe("master");
    });

    it("throws when neither the preferred branch nor the master fallback exist", () => {
      mockedExecFileSync.mockImplementation(() => {
        throw new Error("not found");
      });

      expect(() => detectMainBranch("/repo", "main")).toThrowError();
    });

    it("does not fall back to master when a non-default preferred branch is missing", () => {
      mockedExecFileSync.mockImplementation((_cmd, args) => {
        const argList = args as string[];
        if (argList.includes("refs/heads/master")) {
          return "";
        }
        throw new Error("not found");
      });

      expect(() => detectMainBranch("/repo", "trunk")).toThrowError();
    });
  });
});

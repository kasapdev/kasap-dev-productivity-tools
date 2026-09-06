import { describe, expect, it, vi } from "vitest";
import type { Octokit } from "../src/github.js";
import { fetchChangedFiles, fetchCurrentLabels, syncSizeLabel } from "../src/github.js";

function makeFakeOctokit(overrides: Partial<Octokit["rest"]> = {}): Octokit {
  return {
    rest: {
      pulls: {
        listFiles: vi.fn().mockResolvedValue({ data: [] }),
        ...(overrides.pulls ?? {}),
      },
      issues: {
        listLabelsOnIssue: vi.fn().mockResolvedValue({ data: [] }),
        removeLabel: vi.fn().mockResolvedValue(undefined),
        addLabels: vi.fn().mockResolvedValue(undefined),
        ...(overrides.issues ?? {}),
      },
    },
  } as unknown as Octokit;
}

describe("fetchChangedFiles", () => {
  it("stops after a single page when it comes back under the page size", async () => {
    const octokit = makeFakeOctokit({
      pulls: {
        listFiles: vi.fn().mockResolvedValue({
          data: [{ filename: "a.ts", additions: 1, deletions: 0 }],
        }),
      },
    });

    const files = await fetchChangedFiles(octokit, { owner: "o", repo: "r", pullNumber: 1 });

    expect(files).toEqual([{ filename: "a.ts", additions: 1, deletions: 0 }]);
    expect(octokit.rest.pulls.listFiles).toHaveBeenCalledTimes(1);
    expect(octokit.rest.pulls.listFiles).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      pull_number: 1,
      per_page: 100,
      page: 1,
    });
  });

  it("paginates across multiple pages until a short page is returned", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      filename: `f${i}.ts`,
      additions: 1,
      deletions: 0,
    }));
    const listFiles = vi
      .fn()
      .mockResolvedValueOnce({ data: fullPage })
      .mockResolvedValueOnce({ data: [{ filename: "last.ts", additions: 2, deletions: 1 }] });
    const octokit = makeFakeOctokit({ pulls: { listFiles } });

    const files = await fetchChangedFiles(octokit, { owner: "o", repo: "r", pullNumber: 1 });

    expect(files).toHaveLength(101);
    expect(listFiles).toHaveBeenCalledTimes(2);
  });

  it("stops at the MAX_FILE_PAGES safety cap instead of looping forever when every page is full", async () => {
    // Every page comes back full (100 items), so without a safety cap this
    // would paginate indefinitely. It must stop after exactly 20 pages.
    const listFiles = vi.fn().mockImplementation(async ({ page }: { page: number }) => ({
      data: Array.from({ length: 100 }, (_, i) => ({
        filename: `p${page}-f${i}.ts`,
        additions: 1,
        deletions: 0,
      })),
    }));
    const octokit = makeFakeOctokit({ pulls: { listFiles } });

    const files = await fetchChangedFiles(octokit, { owner: "o", repo: "r", pullNumber: 1 });

    expect(listFiles).toHaveBeenCalledTimes(20);
    expect(files).toHaveLength(2000);
  });
});

describe("fetchCurrentLabels", () => {
  it("maps label objects to their names", async () => {
    const octokit = makeFakeOctokit({
      issues: {
        listLabelsOnIssue: vi
          .fn()
          .mockResolvedValue({ data: [{ name: "bug" }, { name: "size/M" }] }),
        removeLabel: vi.fn(),
        addLabels: vi.fn(),
      },
    });

    const labels = await fetchCurrentLabels(octokit, { owner: "o", repo: "r", issueNumber: 1 });

    expect(labels).toEqual(["bug", "size/M"]);
  });
});

describe("syncSizeLabel", () => {
  it("removes the stale size label then adds the new one", async () => {
    const calls: string[] = [];
    const octokit = makeFakeOctokit({
      issues: {
        listLabelsOnIssue: vi.fn(),
        removeLabel: vi.fn().mockImplementation(async () => {
          calls.push("remove");
        }),
        addLabels: vi.fn().mockImplementation(async () => {
          calls.push("add");
        }),
      },
    });

    await syncSizeLabel(octokit, { owner: "o", repo: "r", issueNumber: 42 }, ["size/S", "bug"], "size/L");

    expect(octokit.rest.issues.removeLabel).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      issue_number: 42,
      name: "size/S",
    });
    expect(octokit.rest.issues.addLabels).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      issue_number: 42,
      labels: ["size/L"],
    });
    expect(calls).toEqual(["remove", "add"]);
  });

  it("does not call addLabels when the label is already present", async () => {
    const octokit = makeFakeOctokit();

    await syncSizeLabel(octokit, { owner: "o", repo: "r", issueNumber: 1 }, ["size/M"], "size/M");

    expect(octokit.rest.issues.removeLabel).not.toHaveBeenCalled();
    expect(octokit.rest.issues.addLabels).not.toHaveBeenCalled();
  });
});

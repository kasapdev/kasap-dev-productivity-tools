import * as github from "@actions/github";
import type { ChangedFile } from "./sizeLabel.js";
import { diffLabels } from "./labels.js";

/** The subset of an authenticated octokit client that this module needs. Kept narrow so tests can supply a hand-written mock instead of a real octokit instance. */
export interface Octokit {
  rest: {
    pulls: {
      listFiles: (params: {
        owner: string;
        repo: string;
        pull_number: number;
        per_page: number;
        page: number;
      }) => Promise<{ data: ChangedFile[] }>;
    };
    issues: {
      listLabelsOnIssue: (params: {
        owner: string;
        repo: string;
        issue_number: number;
      }) => Promise<{ data: { name: string }[] }>;
      removeLabel: (params: {
        owner: string;
        repo: string;
        issue_number: number;
        name: string;
      }) => Promise<unknown>;
      addLabels: (params: {
        owner: string;
        repo: string;
        issue_number: number;
        labels: string[];
      }) => Promise<unknown>;
    };
  };
}

export function getOctokit(token: string): Octokit {
  return github.getOctokit(token) as unknown as Octokit;
}

/** Safety cap on the number of paginated pages fetched from the PR files API. */
const MAX_FILE_PAGES = 20;
const FILES_PER_PAGE = 100;

/**
 * Fetches all changed files for a PR, paginating through the REST API
 * (`GET /repos/{owner}/{repo}/pulls/{pull_number}/files`) until a page comes
 * back with fewer than `FILES_PER_PAGE` entries (i.e. the last page) or the
 * `MAX_FILE_PAGES` safety cap is hit.
 */
export async function fetchChangedFiles(
  octokit: Octokit,
  params: { owner: string; repo: string; pullNumber: number },
): Promise<ChangedFile[]> {
  const files: ChangedFile[] = [];
  for (let page = 1; page <= MAX_FILE_PAGES; page++) {
    const { data } = await octokit.rest.pulls.listFiles({
      owner: params.owner,
      repo: params.repo,
      pull_number: params.pullNumber,
      per_page: FILES_PER_PAGE,
      page,
    });
    files.push(...data);
    if (data.length < FILES_PER_PAGE) {
      break;
    }
  }
  return files;
}

/**
 * Ensures exactly one `size/*` label is active on the issue backing the PR:
 * removes any stale `size/*` labels and adds `newLabel` (if not already
 * present).
 */
export async function syncSizeLabel(
  octokit: Octokit,
  params: { owner: string; repo: string; issueNumber: number },
  currentLabels: readonly string[],
  newLabel: string,
): Promise<void> {
  const { toRemove, toAdd } = diffLabels(currentLabels, newLabel);

  for (const name of toRemove) {
    await octokit.rest.issues.removeLabel({
      owner: params.owner,
      repo: params.repo,
      issue_number: params.issueNumber,
      name,
    });
  }

  if (!currentLabels.includes(toAdd)) {
    await octokit.rest.issues.addLabels({
      owner: params.owner,
      repo: params.repo,
      issue_number: params.issueNumber,
      labels: [toAdd],
    });
  }
}

/** Fetches the current label names on the issue backing the PR. */
export async function fetchCurrentLabels(
  octokit: Octokit,
  params: { owner: string; repo: string; issueNumber: number },
): Promise<string[]> {
  const { data } = await octokit.rest.issues.listLabelsOnIssue({
    owner: params.owner,
    repo: params.repo,
    issue_number: params.issueNumber,
  });
  return data.map((label) => label.name);
}

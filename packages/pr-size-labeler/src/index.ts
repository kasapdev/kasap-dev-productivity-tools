import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  computeSizeLabel,
  computeTotalChangedLines,
  DEFAULT_EXCLUDE_PATTERNS,
  type SizeThresholds,
} from "./sizeLabel.js";
import {
  fetchChangedFiles,
  fetchCurrentLabels,
  getOctokit,
  syncSizeLabel,
} from "./github.js";

/** Splits an action input on commas and/or newlines, trimming and dropping empty entries. */
function parseListInput(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseThresholdInput(name: string): number {
  const raw = core.getInput(name);
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Input "${name}" must be a non-negative number, got: ${raw}`);
  }
  return value;
}

export async function run(): Promise<void> {
  try {
    const token = core.getInput("github-token") || process.env["GITHUB_TOKEN"] || "";
    if (!token) {
      throw new Error(
        "No GitHub token available. Set the 'github-token' input or GITHUB_TOKEN env var.",
      );
    }

    const pullRequest = github.context.payload.pull_request;
    if (!pullRequest) {
      core.warning("This action must be triggered by a pull_request event. Skipping.");
      return;
    }

    const { owner, repo } = github.context.repo;
    const pullNumber = pullRequest.number as number;

    const excludeInput = core.getInput("exclude-patterns");
    const excludePatterns = excludeInput
      ? parseListInput(excludeInput)
      : [...DEFAULT_EXCLUDE_PATTERNS];

    const thresholds: SizeThresholds = {
      xsMax: parseThresholdInput("xs-max"),
      sMax: parseThresholdInput("s-max"),
      mMax: parseThresholdInput("m-max"),
      lMax: parseThresholdInput("l-max"),
    };

    const octokit = getOctokit(token);

    const files = await fetchChangedFiles(octokit, { owner, repo, pullNumber });
    core.info(`Fetched ${files.length} changed file(s) for PR #${pullNumber}.`);

    const totalChangedLines = computeTotalChangedLines(files, excludePatterns);
    const label = computeSizeLabel(totalChangedLines, thresholds);
    core.info(`Total changed lines (after exclusions): ${totalChangedLines} -> ${label}`);

    const currentLabels = await fetchCurrentLabels(octokit, { owner, repo, issueNumber: pullNumber });
    await syncSizeLabel(octokit, { owner, repo, issueNumber: pullNumber }, currentLabels, label);

    core.setOutput("label", label);
    core.setOutput("total-changed-lines", String(totalChangedLines));
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

// Only auto-run when executed as the actual action entrypoint, not when
// imported (e.g. by tests).
if (process.env["VITEST"] === undefined) {
  void run();
}

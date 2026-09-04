#!/usr/bin/env node
import { Command } from "commander";
import type { BranchReportEntry } from "./classify.js";
import { buildReport, DEFAULT_THRESHOLDS } from "./classify.js";
import { writeDeleteScript } from "./scriptGen.js";

function formatDays(days: number): string {
  return days.toFixed(1);
}

function padEnd(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function printReport(mainBranch: string, entries: BranchReportEntry[]): void {
  console.log(`Main branch: ${mainBranch}`);
  console.log("");

  if (entries.length === 0) {
    console.log("No other branches found.");
    return;
  }

  const sorted = [...entries].sort((a, b) => {
    if (a.stale !== b.stale) {
      return a.stale ? -1 : 1;
    }
    return b.daysSinceLastCommit - a.daysSinceLastCommit;
  });

  const nameWidth = Math.max(6, ...sorted.map((e) => e.name.length));
  const header = `${padEnd("BRANCH", nameWidth)}  MERGED  DAYS SINCE COMMIT  STALE`;
  console.log(header);
  console.log("-".repeat(header.length));

  for (const entry of sorted) {
    const row = [
      padEnd(entry.name, nameWidth),
      padEnd(entry.merged ? "yes" : "no", 6),
      padEnd(formatDays(entry.daysSinceLastCommit), 18),
      entry.stale ? "STALE" : "",
    ].join("  ");
    console.log(row);
  }

  const staleCount = sorted.filter((e) => e.stale).length;
  console.log("");
  console.log(`${staleCount} of ${sorted.length} branch(es) flagged as stale.`);
}

const program = new Command();

program
  .name("stale-branch-cleaner")
  .description(
    "Lists local and remote-tracking git branches and classifies them as stale based on " +
      "merge status and last-commit age. Never deletes anything itself - can optionally " +
      "write a reviewable shell script with the delete commands.",
  )
  .option("--repo <path>", "path to the local git repository", process.cwd())
  .option("--main <branch>", "main/base branch name (falls back to master if not found)", "main")
  .option(
    "--merged-days <n>",
    "days since last commit after which a MERGED branch is considered stale",
    String(DEFAULT_THRESHOLDS.mergedThresholdDays),
  )
  .option(
    "--unmerged-days <n>",
    "days since last commit after which an UNMERGED branch is considered stale",
    String(DEFAULT_THRESHOLDS.unmergedThresholdDays),
  )
  .option(
    "--generate-delete-script <path>",
    "also write a reviewable shell script with delete commands for every stale branch " +
      "(the script is only ever written, never executed)",
  )
  .action(async (options: {
    repo: string;
    main: string;
    mergedDays: string;
    unmergedDays: string;
    generateDeleteScript?: string;
  }) => {
    const thresholds = {
      mergedThresholdDays: Number.parseFloat(options.mergedDays),
      unmergedThresholdDays: Number.parseFloat(options.unmergedDays),
    };

    const { mainBranch, entries } = buildReport({
      repoPath: options.repo,
      mainBranchPreference: options.main,
      thresholds,
    });

    printReport(mainBranch, entries);

    if (options.generateDeleteScript) {
      const staleEntries = entries.filter((e) => e.stale);
      writeDeleteScript(options.generateDeleteScript, staleEntries);
      console.log("");
      console.log(
        `Wrote delete script for ${staleEntries.length} stale branch(es) to ` +
          `${options.generateDeleteScript}. Review it before running - nothing was deleted.`,
      );
    }
  });

await program.parseAsync(process.argv);

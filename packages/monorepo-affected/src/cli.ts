#!/usr/bin/env node
import * as path from "node:path";
import { Command } from "commander";
import { discoverWorkspace } from "./workspace.js";
import { buildGraph, computeAffected, topoSort } from "./graph.js";
import {
  getDiffChangedFiles,
  getStatusChangedFiles,
  mapFilesToPackages,
} from "./gitDiff.js";
import { runScriptForPackages } from "./runner.js";
import { computeTestImpact } from "./testImpact.js";

interface CliOptions {
  root: string;
  json: boolean;
  from?: string;
  to?: string;
  run?: string;
  /**
   * `true` when `--test-impact` was passed with no value (use the default
   * script name "test"), a string when passed with an explicit script name,
   * or `undefined` when the flag wasn't passed at all (feature is opt-in).
   */
  testImpact?: string | true;
}

const program = new Command();

program
  .name("monorepo-affected")
  .description(
    "Determine which workspace packages are affected by changes in a pnpm/npm/yarn workspace monorepo.",
  )
  .option("--root <path>", "monorepo root directory", process.cwd())
  .option("--json", "output { directlyChanged, affected } as JSON", false)
  .option("--from <ref>", "diff from this git ref (requires --to)")
  .option("--to <ref>", "diff to this git ref (requires --from)")
  .option(
    "--run <script>",
    "topologically sort the affected packages and run this npm script in each",
  )
  .option(
    "--test-impact [script]",
    'report which affected packages define <script> (default: "test") and should ' +
      "have it run, and which were affected but have no such script",
  )
  .action(async (options: CliOptions) => {
    if ((options.from && !options.to) || (!options.from && options.to)) {
      program.error("--from and --to must be used together");
    }

    const root = path.resolve(options.root);
    const nodes = discoverWorkspace(root);
    const { forward, reverse } = buildGraph(nodes);

    const changedFiles =
      options.from && options.to
        ? getDiffChangedFiles(root, options.from, options.to)
        : getStatusChangedFiles(root);

    const directlyChanged = mapFilesToPackages(changedFiles, nodes, root);
    const affected = computeAffected(directlyChanged, reverse);

    if (options.run) {
      const order = topoSort(affected, forward);
      runScriptForPackages(order, nodes, options.run);
    }

    const testImpactScript = options.testImpact === true ? "test" : options.testImpact;
    const testImpact = testImpactScript
      ? computeTestImpact(affected, nodes, testImpactScript)
      : undefined;

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            directlyChanged: Array.from(directlyChanged).sort(),
            affected: Array.from(affected).sort(),
            ...(testImpact ? { testImpact } : {}),
          },
          null,
          2,
        ),
      );
    } else {
      for (const name of Array.from(affected).sort()) {
        console.log(name);
      }

      if (testImpact) {
        console.log(`\nTest impact (script: "${testImpact.scriptName}"):`);
        if (testImpact.toTest.length === 0) {
          console.log("  (none of the affected packages define this script)");
        } else {
          for (const entry of testImpact.toTest) {
            console.log(`  ${entry.name}`);
          }
        }
        if (testImpact.skipped.length > 0) {
          console.log(
            `Skipped (no "${testImpact.scriptName}" script): ${testImpact.skipped.join(", ")}`,
          );
        }
      }
    }
  });

await program.parseAsync(process.argv);

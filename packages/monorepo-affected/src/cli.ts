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

interface CliOptions {
  root: string;
  json: boolean;
  from?: string;
  to?: string;
  run?: string;
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

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            directlyChanged: Array.from(directlyChanged).sort(),
            affected: Array.from(affected).sort(),
          },
          null,
          2,
        ),
      );
    } else {
      for (const name of Array.from(affected).sort()) {
        console.log(name);
      }
    }
  });

await program.parseAsync(process.argv);

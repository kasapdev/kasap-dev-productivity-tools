import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { PackageNode } from "./workspace.js";

interface RunnablePackageJson {
  scripts?: Record<string, unknown>;
}

/**
 * Run `npm run <script>` for each package name in `order` (expected to
 * already be topologically sorted), skipping packages whose package.json
 * doesn't define that script rather than erroring.
 */
export function runScriptForPackages(
  order: string[],
  nodes: PackageNode[],
  script: string,
  log: (message: string) => void = console.log,
): void {
  const nodeByName = new Map(nodes.map((node) => [node.name, node]));

  for (const name of order) {
    const node = nodeByName.get(name);
    if (!node) {
      log(`[monorepo-affected] skip ${name}: package not found`);
      continue;
    }

    const pkgJsonPath = path.join(node.dir, "package.json");
    if (!fs.existsSync(pkgJsonPath)) {
      log(`[monorepo-affected] skip ${name}: no package.json found`);
      continue;
    }

    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as RunnablePackageJson;
    const scriptCmd = pkg.scripts?.[script];
    if (typeof scriptCmd !== "string") {
      log(`[monorepo-affected] skip ${name}: no "${script}" script defined`);
      continue;
    }

    log(`[monorepo-affected] running "${script}" in ${name}`);
    execFileSync("npm", ["run", script], {
      cwd: node.dir,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
  }
}

import * as fs from "node:fs";
import * as path from "node:path";
import type { PackageNode } from "./workspace.js";

interface RunnablePackageJson {
  scripts?: Record<string, unknown>;
}

export interface TestImpactEntry {
  /** The affected package's name. */
  name: string;
  /** Absolute path to the package directory. */
  dir: string;
  /** The literal script command string from package.json (e.g. "vitest run"). */
  script: string;
}

export interface TestImpactReport {
  /** The script name that was checked for (e.g. "test"). */
  scriptName: string;
  /** Affected packages that define `scriptName`, sorted by name. */
  toTest: TestImpactEntry[];
  /** Affected package names that do NOT define `scriptName`, sorted. */
  skipped: string[];
}

/**
 * Narrow a set of affected packages down to a CI-actionable test-impact
 * report: which of them actually define `scriptName` in their package.json
 * (so a test runner / CI job knows exactly what to invoke, and where), and
 * which were affected but have nothing to run for that script (so they can
 * be reported and skipped rather than silently ignored or erroring).
 *
 * Reads each affected package's package.json off disk to check for the
 * script, mirroring the same lookup `runScriptForPackages` (runner.ts) does
 * at execution time -- `PackageNode` deliberately doesn't carry `scripts`,
 * since most callers of `discoverWorkspace` never need them.
 */
export function computeTestImpact(
  affected: Iterable<string>,
  nodes: PackageNode[],
  scriptName: string,
): TestImpactReport {
  const nodeByName = new Map(nodes.map((node) => [node.name, node]));

  const toTest: TestImpactEntry[] = [];
  const skipped: string[] = [];

  for (const name of Array.from(affected).sort()) {
    const node = nodeByName.get(name);
    if (!node) {
      skipped.push(name);
      continue;
    }

    const pkgJsonPath = path.join(node.dir, "package.json");
    if (!fs.existsSync(pkgJsonPath)) {
      skipped.push(name);
      continue;
    }

    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as RunnablePackageJson;
    const scriptCmd = pkg.scripts?.[scriptName];
    if (typeof scriptCmd !== "string") {
      skipped.push(name);
      continue;
    }

    toTest.push({ name, dir: node.dir, script: scriptCmd });
  }

  return { scriptName, toTest, skipped };
}

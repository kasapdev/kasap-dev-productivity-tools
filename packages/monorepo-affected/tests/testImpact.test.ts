import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeTestImpact } from "../src/testImpact.js";
import type { PackageNode } from "../src/workspace.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "monorepo-affected-testimpact-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function writePackage(dir: string, data: unknown): PackageNode {
  const fullDir = path.join(tmpRoot, dir);
  fs.mkdirSync(fullDir, { recursive: true });
  fs.writeFileSync(path.join(fullDir, "package.json"), JSON.stringify(data, null, 2));
  return { name: (data as { name: string }).name, dir: fullDir, dependencies: [] };
}

describe("computeTestImpact", () => {
  it("splits affected packages into toTest / skipped based on whether they define the script", () => {
    const withTest = writePackage("packages/api", {
      name: "@fixture/api",
      scripts: { test: "vitest run", build: "tsc" },
    });
    const withoutTest = writePackage("packages/docs", {
      name: "@fixture/docs",
      scripts: { build: "tsc" },
    });
    const nodes = [withTest, withoutTest];

    const report = computeTestImpact(["@fixture/api", "@fixture/docs"], nodes, "test");

    expect(report.scriptName).toBe("test");
    expect(report.toTest).toEqual([
      { name: "@fixture/api", dir: withTest.dir, script: "vitest run" },
    ]);
    expect(report.skipped).toEqual(["@fixture/docs"]);
  });

  it("returns an empty report for an empty affected set", () => {
    const report = computeTestImpact([], [], "test");
    expect(report).toEqual({ scriptName: "test", toTest: [], skipped: [] });
  });

  it("sorts toTest and skipped by package name regardless of input order", () => {
    const b = writePackage("packages/b", { name: "b", scripts: { test: "vitest run" } });
    const a = writePackage("packages/a", { name: "a", scripts: { test: "vitest run" } });
    const d = writePackage("packages/d", { name: "d", scripts: {} });
    const c = writePackage("packages/c", { name: "c", scripts: {} });

    const report = computeTestImpact(["d", "b", "c", "a"], [b, a, d, c], "test");

    expect(report.toTest.map((e) => e.name)).toEqual(["a", "b"]);
    expect(report.skipped).toEqual(["c", "d"]);
  });

  it("skips a name absent from the discovered nodes instead of throwing (defensive)", () => {
    const report = computeTestImpact(["@fixture/ghost"], [], "test");
    expect(report.toTest).toEqual([]);
    expect(report.skipped).toEqual(["@fixture/ghost"]);
  });

  it("treats a non-string script value (e.g. an npm-workspaces script object) as absent", () => {
    const node = writePackage("packages/weird", {
      name: "@fixture/weird",
      // Not a realistic package.json, but scripts values are untyped JSON --
      // guard against anything that isn't the expected string command.
      scripts: { test: { command: "vitest" } },
    });

    const report = computeTestImpact(["@fixture/weird"], [node], "test");
    expect(report.toTest).toEqual([]);
    expect(report.skipped).toEqual(["@fixture/weird"]);
  });

  it("respects a custom script name other than the default 'test'", () => {
    const node = writePackage("packages/api", {
      name: "@fixture/api",
      scripts: { "test:unit": "vitest run --project unit", test: "vitest run" },
    });

    const report = computeTestImpact(["@fixture/api"], [node], "test:unit");
    expect(report.scriptName).toBe("test:unit");
    expect(report.toTest).toEqual([
      { name: "@fixture/api", dir: node.dir, script: "vitest run --project unit" },
    ]);
  });
});

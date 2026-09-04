import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverWorkspace, getWorkspaceGlobs } from "../src/workspace.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "monorepo-affected-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function seedFixturePackages(root: string): void {
  writeJson(path.join(root, "packages/core/package.json"), {
    name: "@fixture/core",
    version: "1.0.0",
  });
  writeJson(path.join(root, "packages/utils/package.json"), {
    name: "@fixture/utils",
    version: "1.0.0",
    dependencies: {
      "@fixture/core": "workspace:*",
    },
  });
  writeJson(path.join(root, "packages/api/package.json"), {
    name: "@fixture/api",
    version: "1.0.0",
    dependencies: {
      // Plain semver range that happens to match a discovered workspace
      // package's name — should still be treated as a workspace edge.
      "@fixture/utils": "^1.0.0",
    },
  });
}

describe("discoverWorkspace via pnpm-workspace.yaml", () => {
  it("discovers packages and dependency edges", () => {
    fs.writeFileSync(
      path.join(tmpRoot, "pnpm-workspace.yaml"),
      'packages:\n  - "packages/*"\n',
    );
    writeJson(path.join(tmpRoot, "package.json"), { name: "root", private: true });
    seedFixturePackages(tmpRoot);

    const nodes = discoverWorkspace(tmpRoot);
    const byName = new Map(nodes.map((n) => [n.name, n]));

    expect(new Set(nodes.map((n) => n.name))).toEqual(
      new Set(["@fixture/core", "@fixture/utils", "@fixture/api"]),
    );

    expect(byName.get("@fixture/core")?.dir).toBe(
      path.join(tmpRoot, "packages", "core"),
    );
    expect(byName.get("@fixture/core")?.dependencies).toEqual([]);
    expect(byName.get("@fixture/utils")?.dependencies).toEqual(["@fixture/core"]);
    // Name-fallback match: plain semver range referencing a known workspace name.
    expect(byName.get("@fixture/api")?.dependencies).toEqual(["@fixture/utils"]);
  });
});

describe("discoverWorkspace via root package.json workspaces field (fallback)", () => {
  it("discovers packages when no pnpm-workspace.yaml is present (array form)", () => {
    writeJson(path.join(tmpRoot, "package.json"), {
      name: "root",
      private: true,
      workspaces: ["packages/*"],
    });
    seedFixturePackages(tmpRoot);

    const nodes = discoverWorkspace(tmpRoot);
    expect(new Set(nodes.map((n) => n.name))).toEqual(
      new Set(["@fixture/core", "@fixture/utils", "@fixture/api"]),
    );

    const byName = new Map(nodes.map((n) => [n.name, n]));
    expect(byName.get("@fixture/utils")?.dependencies).toEqual(["@fixture/core"]);
  });

  it("supports the object form { packages: [...] }", () => {
    writeJson(path.join(tmpRoot, "package.json"), {
      name: "root",
      private: true,
      workspaces: { packages: ["packages/*"] },
    });
    seedFixturePackages(tmpRoot);

    const globs = getWorkspaceGlobs(tmpRoot);
    expect(globs).toEqual(["packages/*"]);

    const nodes = discoverWorkspace(tmpRoot);
    expect(new Set(nodes.map((n) => n.name))).toEqual(
      new Set(["@fixture/core", "@fixture/utils", "@fixture/api"]),
    );
  });
});

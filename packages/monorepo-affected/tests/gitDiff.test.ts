import { describe, expect, it } from "vitest";
import {
  mapFilesToPackages,
  parseNameOnlyDiff,
  parsePorcelainStatus,
} from "../src/gitDiff.js";
import type { PackageNode } from "../src/workspace.js";

describe("parsePorcelainStatus", () => {
  it("parses a plain modified entry", () => {
    expect(parsePorcelainStatus(" M packages/api/src/index.ts\n")).toEqual([
      "packages/api/src/index.ts",
    ]);
  });

  it("takes the new path (not the old path) for a rename entry", () => {
    const output = "R  packages/api/src/old.ts -> packages/api/src/new.ts\n";
    expect(parsePorcelainStatus(output)).toEqual(["packages/api/src/new.ts"]);
  });

  it("strips surrounding quotes git adds around paths with special characters", () => {
    const output = '?? "packages/api/src/weird name.ts"\n';
    expect(parsePorcelainStatus(output)).toEqual(["packages/api/src/weird name.ts"]);
  });

  it("skips blank lines and returns an empty array for empty output", () => {
    expect(parsePorcelainStatus("")).toEqual([]);
    expect(parsePorcelainStatus("\n\n")).toEqual([]);
  });
});

describe("parseNameOnlyDiff", () => {
  it("parses one path per line and drops a trailing blank line", () => {
    const output = "packages/api/src/index.ts\npackages/web/src/App.tsx\n";
    expect(parseNameOnlyDiff(output)).toEqual([
      "packages/api/src/index.ts",
      "packages/web/src/App.tsx",
    ]);
  });

  it("returns an empty array for empty output", () => {
    expect(parseNameOnlyDiff("")).toEqual([]);
  });
});

describe("mapFilesToPackages", () => {
  const root = "/repo";

  function node(name: string, relDir: string): PackageNode {
    return { name, dir: `${root}/${relDir}`, dependencies: [] };
  }

  it("maps a file to the package whose directory contains it", () => {
    const nodes = [node("@fixture/api", "packages/api"), node("@fixture/web", "packages/web")];
    const result = mapFilesToPackages(["packages/api/src/index.ts"], nodes, root);
    expect(result).toEqual(new Set(["@fixture/api"]));
  });

  it("drops files that fall outside every package directory", () => {
    const nodes = [node("@fixture/api", "packages/api")];
    const result = mapFilesToPackages(["README.md", "pnpm-workspace.yaml"], nodes, root);
    expect(result).toEqual(new Set());
  });

  it("does not misattribute a file to a sibling package whose name is a string prefix but not a path ancestor", () => {
    // "packages/foo" is a literal string-prefix of "packages/foo-bar/x.ts",
    // but is NOT its directory ancestor -- the file must map to foo-bar only.
    const nodes = [node("@fixture/foo", "packages/foo"), node("@fixture/foo-bar", "packages/foo-bar")];
    const result = mapFilesToPackages(["packages/foo-bar/src/x.ts"], nodes, root);
    expect(result).toEqual(new Set(["@fixture/foo-bar"]));
  });

  it("picks the longest (most specific) matching directory when packages are nested", () => {
    const nodes = [node("@fixture/outer", "packages/outer"), node("@fixture/inner", "packages/outer/inner")];
    const result = mapFilesToPackages(["packages/outer/inner/src/x.ts"], nodes, root);
    expect(result).toEqual(new Set(["@fixture/inner"]));
  });

  it("matches a file that IS the package directory itself (no trailing segment)", () => {
    const nodes = [node("@fixture/api", "packages/api")];
    const result = mapFilesToPackages(["packages/api"], nodes, root);
    expect(result).toEqual(new Set(["@fixture/api"]));
  });
});

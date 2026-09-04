import { describe, expect, it } from "vitest";
import { buildGraph, computeAffected, topoSort } from "../src/graph.js";
import type { PackageNode } from "../src/workspace.js";

function node(name: string, dependencies: string[]): PackageNode {
  return { name, dir: `/fake/${name}`, dependencies };
}

// Chain: core <- utils <- api <- web (web depends on api depends on utils depends on core)
// Diamond: shared <- left, shared <- right, both left and right <- app
// Plus an isolated leaf with no dependents and no dependencies.
const fixtureNodes: PackageNode[] = [
  node("core", []),
  node("utils", ["core"]),
  node("api", ["utils"]),
  node("web", ["api"]),
  node("shared", []),
  node("left", ["shared"]),
  node("right", ["shared"]),
  node("app", ["left", "right"]),
  node("standalone", []),
];

describe("computeAffected", () => {
  it("propagates a chain-transitive change through multiple hops", () => {
    const { reverse } = buildGraph(fixtureNodes);
    const affected = computeAffected(["core"], reverse);

    expect(affected).toEqual(new Set(["core", "utils", "api", "web"]));
    // Unrelated packages must not be pulled in.
    expect(affected.has("shared")).toBe(false);
    expect(affected.has("app")).toBe(false);
    expect(affected.has("standalone")).toBe(false);
  });

  it("collapses a diamond so the shared dependent appears exactly once", () => {
    const { reverse } = buildGraph(fixtureNodes);
    const affected = computeAffected(["shared"], reverse);

    expect(affected).toEqual(new Set(["shared", "left", "right", "app"]));
    expect(affected.size).toBe(4);
  });

  it("affects only itself for a leaf package with no dependents", () => {
    const { reverse } = buildGraph(fixtureNodes);
    const affected = computeAffected(["standalone"], reverse);

    expect(affected).toEqual(new Set(["standalone"]));
  });
});

describe("topoSort", () => {
  it("orders every package strictly after all of its in-set dependencies", () => {
    const { forward } = buildGraph(fixtureNodes);
    const affected = new Set([
      "core",
      "utils",
      "api",
      "web",
      "shared",
      "left",
      "right",
      "app",
    ]);

    const order = topoSort(affected, forward);

    expect(new Set(order)).toEqual(affected);
    expect(order.length).toBe(affected.size);

    const indexOf = new Map(order.map((name, i) => [name, i]));
    for (const name of affected) {
      const deps = forward.get(name) ?? new Set<string>();
      for (const dep of deps) {
        if (!affected.has(dep)) continue;
        const depIndex = indexOf.get(dep);
        const nameIndex = indexOf.get(name);
        expect(depIndex).toBeDefined();
        expect(nameIndex).toBeDefined();
        // dep must come before name, since name depends on dep.
        expect(depIndex as number).toBeLessThan(nameIndex as number);
      }
    }
  });

  it("throws a clear error instead of hanging or mis-ordering on a cycle", () => {
    const cyclicNodes: PackageNode[] = [node("a", ["b"]), node("b", ["a"])];
    const { forward } = buildGraph(cyclicNodes);
    const affected = new Set(["a", "b"]);

    expect(() => topoSort(affected, forward)).toThrow(/cycle/i);
  });
});

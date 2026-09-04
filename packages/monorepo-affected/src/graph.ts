import type { PackageNode } from "./workspace.js";

export interface AdjacencyMaps {
  /** name -> set of names it depends on. */
  forward: Map<string, Set<string>>;
  /** name -> set of names that depend on it. */
  reverse: Map<string, Set<string>>;
}

function getOrCreate(map: Map<string, Set<string>>, key: string): Set<string> {
  let set = map.get(key);
  if (!set) {
    set = new Set<string>();
    map.set(key, set);
  }
  return set;
}

/**
 * Build forward ("depends on") and reverse ("depended on by") adjacency maps
 * from a package node list. Pure function, no I/O.
 */
export function buildGraph(nodes: PackageNode[]): AdjacencyMaps {
  const forward = new Map<string, Set<string>>();
  const reverse = new Map<string, Set<string>>();

  for (const node of nodes) {
    getOrCreate(forward, node.name);
    getOrCreate(reverse, node.name);
  }

  for (const node of nodes) {
    for (const dep of node.dependencies) {
      getOrCreate(forward, node.name).add(dep);
      getOrCreate(reverse, dep).add(node.name);
      // Ensure the dependency itself has a forward entry even if it wasn't
      // one of the discovered nodes' names directly (defensive; normally it
      // will be, since deps are matched against discovered package names).
      getOrCreate(forward, dep);
    }
  }

  return { forward, reverse };
}

/**
 * Compute the full set of affected packages: every directly changed
 * package, plus every package that transitively depends on one (walked via
 * the reverse adjacency map, BFS). Diamonds collapse naturally since the
 * result is a Set.
 */
export function computeAffected(
  directlyChanged: Iterable<string>,
  reverse: Map<string, Set<string>>,
): Set<string> {
  const affected = new Set<string>();
  const queue: string[] = [];

  for (const name of directlyChanged) {
    if (!affected.has(name)) {
      affected.add(name);
      queue.push(name);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const dependents = reverse.get(current);
    if (!dependents) continue;
    for (const dependent of dependents) {
      if (!affected.has(dependent)) {
        affected.add(dependent);
        queue.push(dependent);
      }
    }
  }

  return affected;
}

/**
 * Topologically sort the affected set, restricted to edges within that set,
 * such that every package appears after all packages (within the affected
 * set) that it depends on. Uses Kahn's algorithm. Throws a clear error if a
 * cycle is detected within the affected subgraph.
 */
export function topoSort(
  affected: Set<string>,
  forward: Map<string, Set<string>>,
): string[] {
  const inDegree = new Map<string, number>();
  for (const name of affected) {
    inDegree.set(name, 0);
  }

  // dependent[name] = set of affected packages that directly depend on `name`
  const dependentsWithinAffected = new Map<string, Set<string>>();
  for (const name of affected) {
    getOrCreate(dependentsWithinAffected, name);
  }

  for (const name of affected) {
    const deps = forward.get(name);
    if (!deps) continue;
    for (const dep of deps) {
      if (affected.has(dep)) {
        inDegree.set(name, (inDegree.get(name) ?? 0) + 1);
        getOrCreate(dependentsWithinAffected, dep).add(name);
      }
    }
  }

  const queue: string[] = [];
  for (const [name, degree] of inDegree) {
    if (degree === 0) queue.push(name);
  }
  queue.sort();

  const order: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    order.push(current);

    const dependents = dependentsWithinAffected.get(current);
    if (!dependents) continue;

    const nowZero: string[] = [];
    for (const dependent of dependents) {
      const remaining = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, remaining);
      if (remaining === 0) nowZero.push(dependent);
    }
    nowZero.sort();
    queue.push(...nowZero);
  }

  if (order.length !== affected.size) {
    const remaining = Array.from(affected).filter((name) => !order.includes(name));
    throw new Error(
      `Cycle detected in package dependency graph involving: ${remaining.sort().join(", ")}`,
    );
  }

  return order;
}

# @kasap/monorepo-affected

A CLI that determines which workspace packages are affected by a set of
changed files in a pnpm/npm/yarn workspace monorepo, by building a
dependency graph from each package's `package.json` and walking it
transitively -- then can run a script across those packages in topological
order, or report exactly which of them need their tests run.

## How it works

1. **Discover** every workspace package under `--root` (default: cwd), via
   `pnpm-workspace.yaml`'s `packages:` array or the root `package.json`'s
   `workspaces` field (array or `{ packages: [...] }` object form).
2. **Build a dependency graph**: an edge A -> B ("A depends on B") is recorded
   when A's `dependencies`/`devDependencies`/`peerDependencies` references B
   via a `workspace:`/`file:` protocol, or by exact name match against
   another discovered package.
3. **Get changed files**, either from `git status --porcelain` (default -- i.e.
   your working tree's uncommitted changes) or `git diff --name-only <from>
   <to>` when both `--from` and `--to` are given.
4. **Map changed files to packages** (longest directory-prefix match) to get
   the set of *directly changed* packages.
5. **Compute the affected set**: every directly changed package, plus every
   package that transitively depends on one (reverse-graph BFS). A `--json`
   flag is available for scripting; otherwise one package name per line is
   printed to stdout.

## Usage

```sh
# Affected packages for your current uncommitted changes
monorepo-affected

# Affected packages between two refs (e.g. in CI, comparing a PR branch to main)
monorepo-affected --from origin/main --to HEAD --json

# Run "build" in every affected package, in dependency order
monorepo-affected --from origin/main --to HEAD --run build

# Point at a monorepo root other than the current directory
monorepo-affected --root ../other-monorepo
```

## Test impact report (`--test-impact`)

CI test suites usually shouldn't run every package's tests on every change --
only the tests for packages that were actually affected, and only if they
even define a test script. `--test-impact [script]` reuses the same affected
set (no separate computation) and narrows it down: which affected packages
define `script` in their `package.json` (default script name: `"test"`,
if the flag is passed with no value) and should have it run, versus which
were affected but have no such script and can be skipped.

```sh
# Default script name ("test")
monorepo-affected --from origin/main --to HEAD --test-impact

# Explicit script name, e.g. a package that separates unit/integration tests
monorepo-affected --from origin/main --to HEAD --test-impact test:unit

# Machine-readable, for a CI test-selection step
monorepo-affected --from origin/main --to HEAD --json --test-impact
```

Text output:

```
@kasap/api
@kasap/web

Test impact (script: "test"):
  @kasap/api
Skipped (no "test" script): @kasap/web
```

`--json` output adds a `testImpact` object alongside the existing
`directlyChanged`/`affected` arrays:

```json
{
  "directlyChanged": ["@kasap/api"],
  "affected": ["@kasap/api", "@kasap/web"],
  "testImpact": {
    "scriptName": "test",
    "toTest": [
      { "name": "@kasap/api", "dir": "/repo/packages/api", "script": "vitest run" }
    ],
    "skipped": ["@kasap/web"]
  }
}
```

A CI step can consume `testImpact.toTest` directly to decide exactly which
packages to run tests in (and where), e.g.:

```sh
node packages/monorepo-affected/dist/cli.js --from origin/main --to HEAD --json --test-impact \
  | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8")); for (const p of r.testImpact.toTest) console.log(p.name)'
```

## Options

| Option              | Description                                                                          |
| -------------------- | ------------------------------------------------------------------------------------ |
| `--root <path>`     | Monorepo root directory. Default: current working directory.                        |
| `--json`            | Output `{ directlyChanged, affected }` (and `testImpact`, if requested) as JSON.     |
| `--from <ref>`      | Diff from this git ref. Requires `--to`.                                            |
| `--to <ref>`        | Diff to this git ref. Requires `--from`. Without `--from`/`--to`, uses `git status`. |
| `--run <script>`    | Topologically sort the affected packages and run this npm script in each.           |
| `--test-impact [script]` | Report which affected packages define `script` (default `"test"`) and should have it run, and which were skipped. |

## Development

```sh
pnpm --filter @kasap/monorepo-affected build
pnpm --filter @kasap/monorepo-affected typecheck
pnpm --filter @kasap/monorepo-affected test
```

Tests use real temporary directories (`fs.mkdtempSync` under `os.tmpdir()`)
with fixture `package.json` files for workspace discovery and test-impact
lookups, and pure fixture graphs (no filesystem or git) for the
`buildGraph`/`computeAffected`/`topoSort` logic.

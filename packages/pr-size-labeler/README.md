# @kasap/pr-size-labeler

A GitHub Action that labels pull requests `size/XS` through `size/XL` based on the
total number of changed lines (additions + deletions), excluding files that match
configurable glob patterns (lockfiles, generated/bundled output, etc.).

It reads per-file stats from the GitHub REST API (`GET
/repos/{owner}/{repo}/pulls/{pull_number}/files`) rather than the PR-level
additions/deletions totals, so specific files (e.g. `pnpm-lock.yaml`, `dist/**`)
can be excluded from the size calculation.

## How it works

On `pull_request` events (`opened`, `synchronize`):

1. Fetches all changed files for the PR (paginated, up to 20 pages of 100 files).
2. Sums `additions + deletions` across files, skipping any file whose path matches
   one of `exclude-patterns` (matched with real glob semantics via
   [`minimatch`](https://www.npmjs.com/package/minimatch), not substring checks).
3. Maps the total to a size label using exclusive upper bounds:
   - `total < xs-max` → `size/XS`
   - `total < s-max` → `size/S`
   - `total < m-max` → `size/M`
   - `total < l-max` → `size/L`
   - otherwise → `size/XL`

   For example, with the default thresholds, a total of exactly `10` maps to
   `size/S` (not `size/XS`), since `size/XS` requires `total < 10`.
4. Removes any existing `size/*` label from the PR and applies the computed one,
   so exactly one size label is active at a time.

## Inputs

| Input               | Required | Default                                                                          | Description                                                        |
| -------------------- | -------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `github-token`       | No       | `${{ github.token }}`                                                            | Token used to read PR file stats and manage labels.                |
| `exclude-patterns`   | No       | `**/pnpm-lock.yaml,**/package-lock.json,**/yarn.lock,**/*.lock,dist/**,**/*.min.js` | Comma- or newline-separated glob patterns excluded from the count. |
| `xs-max`             | No       | `10`                                                                              | Exclusive upper bound (changed lines) for `size/XS`.                |
| `s-max`              | No       | `50`                                                                              | Exclusive upper bound (changed lines) for `size/S`.                 |
| `m-max`              | No       | `250`                                                                             | Exclusive upper bound (changed lines) for `size/M`.                 |
| `l-max`              | No       | `1000`                                                                            | Exclusive upper bound (changed lines) for `size/L`. `>= l-max` is `size/XL`. |

## Outputs

| Output                 | Description                                    |
| ------------------------ | ------------------------------------------------- |
| `label`                 | The size label that was applied.               |
| `total-changed-lines`   | Total changed lines counted, after exclusions. |

## Usage

```yaml
# .github/workflows/pr-size.yml
name: PR Size Label

on:
  pull_request:
    types: [opened, synchronize]

permissions:
  pull-requests: write

jobs:
  label:
    runs-on: ubuntu-latest
    steps:
      - uses: kasapdev/kasap-dev-productivity-tools/packages/pr-size-labeler@master
        with:
          exclude-patterns: "**/*.lock,dist/**,**/*.generated.ts"
          xs-max: "10"
          s-max: "50"
          m-max: "250"
          l-max: "1000"
```

The `github-token` input defaults to `${{ github.token }}`, so it usually does not
need to be set explicitly. `permissions: pull-requests: write` is required for the
action to add/remove labels on the PR.

## Development

This package builds two ways from the same `src/`:

- `tsc` compiles per-file output (for typechecking and workspace-wide `declaration`
  consistency).
- `esbuild` then bundles `src/index.ts` into a single dependency-free
  `dist/index.js`, which is the file `action.yml`'s `main:` points at. GitHub
  Actions runs `node20` actions directly, without an `npm install` step, so the
  bundle must be self-contained.

```sh
pnpm --filter @kasap/pr-size-labeler build
pnpm --filter @kasap/pr-size-labeler test
```

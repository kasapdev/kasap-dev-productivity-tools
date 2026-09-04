# kasap-dev-productivity-tools

A small portfolio of genuinely working developer-productivity CLIs and GitHub Actions,
built as a pnpm workspace monorepo (TypeScript + ESM throughout).

## Packages

| Package | Description |
| --- | --- |
| [`dotfiles-sync`](packages/dotfiles-sync) | Syncs dotfiles between a central dotfiles repo and your home directory via real symlinks, with AES-256-GCM encrypted secret files. |
| [`snippet-vault`](packages/snippet-vault) | Personal code-snippet manager backed by SQLite, with full-text search and clipboard copy support. |
| [`pr-size-labeler`](packages/pr-size-labeler) | GitHub Action that labels pull requests `size/XS`..`size/XL` based on configurable changed-line thresholds and glob exclusions. |
| [`stale-branch-cleaner`](packages/stale-branch-cleaner) | Reports stale local/remote git branches (merged + old, or old + unmerged) and can generate a review-first cleanup script. Never deletes anything itself. |
| [`monorepo-affected`](packages/monorepo-affected) | Computes which workspace packages are affected by a git diff via dependency-graph transitive closure, and can run a script across them in topological order. |

## Conventions

- pnpm workspace (`pnpm-workspace.yaml`), Node >= 22.5.0, `packageManager: pnpm@11.22.0`
- TypeScript + ESM (`tsconfig.base.json` extended per package), strict mode
- Each package: `src/`, `tests/` (vitest, no real network calls in CI), `package.json`, `README.md`
- MIT licensed

## Getting started

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

## License

MIT © Kayra Kasapoğlu

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Fixed

- `packages/dotfiles-sync`: `validateManifest` now rejects two manifest
  entries whose `target` resolves to the same path (comparing resolved, not
  raw, paths, so `"~/.foo"` and its expanded absolute equivalent are caught
  too). Previously this went unvalidated: two entries sharing a target would
  fight over it on every `link` run, each treating the other's link as
  "diverged" and re-linking over it, silently piling up a fresh
  `target.backup.N` file each time the tool ran.

## 2026-09-08

### Added

- `packages/monorepo-affected` (0.1.0 -> 0.2.0): a `--test-impact [script]`
  CLI flag and `computeTestImpact` function (`src/testImpact.ts`). Reuses the
  existing affected-package set to produce a CI-actionable report: which
  affected packages actually define `script` in their `package.json`
  (default `"test"`) and should have it run (`toTest`, with each entry's
  resolved directory and literal script command), versus which were
  affected but define no such script and can be skipped (`skipped`).
  Available in both text and `--json` output. Added `packages/monorepo-affected/README.md`
  (the package previously had none, despite the repo's stated per-package
  convention).
- `packages/monorepo-affected`: `tests/gitDiff.test.ts`, covering
  `parsePorcelainStatus`, `parseNameOnlyDiff`, and `mapFilesToPackages` —
  previously `src/gitDiff.ts` had no tests at all. Includes an edge case for
  `mapFilesToPackages` where one package's directory name is a literal
  string-prefix of a sibling's (e.g. `packages/foo` vs. `packages/foo-bar`),
  confirming files under `foo-bar` are not misattributed to `foo`; no bug
  found, the existing trailing-slash-guarded prefix check already handles it
  correctly.

## 2026-09-06

### Added

- `packages/snippet-vault`: a test in `tests/store.test.ts` covering that
  `searchSnippets` treats SQL `LIKE` wildcard characters (`%` and `_`) in the
  search query as literal text rather than as wildcards (e.g. searching for
  `"50%"` must not spuriously match `"5000"`, and `"c_t"` must not match
  `"cat"`/`"cot"` via wildcard expansion). Confirms the existing `escapeLike`
  helper in `src/store.ts` already handles this correctly.
- `packages/pr-size-labeler`: a test in `tests/github.test.ts` covering the
  `MAX_FILE_PAGES` safety cap in `fetchChangedFiles` — asserts pagination
  stops after exactly 20 pages (rather than looping indefinitely) when the
  GitHub API keeps returning full pages of changed files.

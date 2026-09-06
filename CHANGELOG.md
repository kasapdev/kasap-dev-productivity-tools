# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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

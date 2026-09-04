# @kasap/snippet-vault

A personal CLI snippet manager. Stores named code/text snippets in a local
SQLite database (via Node's built-in `node:sqlite` module — no extra
dependency) and lets you save, fetch (with automatic clipboard copy),
search, list, and delete them.

## Storage

- Default DB path: `~/.snippet-vault/snippets.sqlite`
- Override with the `SNIPPET_VAULT_DB_PATH` environment variable, or a
  per-invocation `--db <path>` flag (takes precedence over the env var).

Schema (table `snippets`):

| column     | type | notes                          |
|------------|------|---------------------------------|
| name       | TEXT | primary key, unique             |
| content    | TEXT | snippet body                    |
| lang       | TEXT | nullable                        |
| tags       | TEXT | comma-separated, `""` if none   |
| created_at | TEXT | ISO 8601 timestamp              |
| updated_at | TEXT | ISO 8601 timestamp              |

## Usage

```sh
# Save from a file
snippet-vault save my-hook --lang tsx --tags react,hooks --file ./useThing.tsx

# Save from stdin (pipe anything in)
cat foo.ts | snippet-vault save foo --lang ts

# Fetch a snippet: prints to stdout AND copies to the system clipboard
snippet-vault get my-hook

# Search (case-insensitive substring match across name, content, tags)
snippet-vault search "react"
snippet-vault search "hook" --tag react

# List everything
snippet-vault list

# Delete
snippet-vault delete my-hook

# Use a custom DB file (handy for scripting/testing)
snippet-vault --db ./scratch.sqlite list
```

### Clipboard support

`get` attempts to copy the snippet content to your system clipboard by
shelling out to a platform-appropriate command:

- Windows: `clip`
- macOS: `pbcopy`
- Linux: `xclip -selection clipboard`, falling back to `xsel --clipboard --input`
  if `xclip` isn't installed

If none of these are available (e.g. a headless CI environment), the
content is still printed to stdout and a warning is printed to stderr —
the command does not fail.

## Development

```sh
pnpm --filter @kasap/snippet-vault build
pnpm --filter @kasap/snippet-vault typecheck
pnpm --filter @kasap/snippet-vault test
```

Requires Node.js >= 22.5 (for `node:sqlite`).

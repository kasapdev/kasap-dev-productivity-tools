# @kasap/dotfiles-sync

A CLI that syncs a manifest of dotfiles between a central "dotfiles repo"
directory and your home directory using **real symlinks** (junctions on
Windows), with built-in **AES-256-GCM** encryption for secrets that must not
live in the repo as plaintext (SSH keys, API tokens, etc).

## Install / run

Inside this workspace:

```sh
pnpm --filter @kasap/dotfiles-sync build
node packages/dotfiles-sync/dist/cli.js --help
```

Or, once built, via the `dotfiles-sync` bin.

## The manifest: `dotfiles.json`

By default, `dotfiles-sync` looks for `~/.dotfiles/dotfiles.json`. Override
the repo directory with `--repo <dir>`, or the manifest path directly with
`--manifest <path>`.

```json
{
  "entries": [
    { "name": "gitconfig", "source": "git/gitconfig", "target": "~/.gitconfig" },
    { "name": "nvim", "source": "nvim", "target": "~/.config/nvim" },
    { "name": "ssh-key", "source": "ssh/id_ed25519.enc", "target": "~/.ssh/id_ed25519", "secret": true }
  ]
}
```

- `name` -- unique identifier used in logs/status output.
- `source` -- path **relative to the repo dir**. For `secret: true` entries,
  this is the path to the *encrypted envelope* (see below), not plaintext.
  There's no enforced suffix, but this tool's own `encrypt` command defaults
  to `<basename>.enc` by convention.
- `target` -- absolute path, or a `~`-relative path, of where the file/dir
  should end up in your home directory.
- `secret` -- optional, defaults to `false`.

## Commands

```
dotfiles-sync link    [--repo <dir>] [--manifest <path>]
dotfiles-sync unlink  [--repo <dir>] [--manifest <path>]
dotfiles-sync status  [--repo <dir>] [--manifest <path>]
dotfiles-sync encrypt <file> [--repo <dir>] [--out <relativePath>]
```

### `link`

For every manifest entry:

- **Non-secret**: creates a real symlink `target -> source`. If something
  already exists at `target` and it isn't already the correct managed
  link/copy, it's backed up first (renamed to `target.backup`, or
  `target.backup.1`, `.2`, ... if that already exists) and the move is
  logged.
- **Secret**: decrypts the encrypted envelope from the repo and writes the
  **plaintext only to `target`**. The plaintext is never written back into
  the repo directory.

### `unlink`

Removes the managed `target` for each entry, but conservatively: it only
removes a target that is verifiably ours (a symlink pointing at the repo
source, or -- on the Windows copy-fallback path -- a copy/decrypted file
whose content still matches the source). Anything that looks like it was
edited independently is left alone and a warning is printed.

### `status`

Prints a table with one of three states per entry:

| state      | meaning                                                                 |
|------------|--------------------------------------------------------------------------|
| `linked`   | target is a correct symlink to the source (or, on Windows fallback, a copy/decrypted file whose content matches) |
| `missing`  | target does not exist yet                                               |
| `diverged` | target exists but points elsewhere / has different content than source  |

For secret entries, `status` also reports whether the encrypted blob exists
in the repo, and (only when `DOTFILES_SYNC_PASSPHRASE` is set, so the tool
can actually decrypt and compare) whether the decrypted target is up to
date.

### `encrypt <file>`

Encrypts a plaintext file into an AES-256-GCM envelope written into the repo
dir, so you can add it to the manifest as a `secret: true` entry:

```sh
dotfiles-sync encrypt ~/.ssh/id_ed25519 --repo ~/.dotfiles --out ssh/id_ed25519.enc
```

## Secrets: encrypted file format

Each `.enc` file is a JSON envelope, e.g.:

```json
{
  "version": 1,
  "algorithm": "aes-256-gcm",
  "kdf": "scrypt",
  "salt": "base64...",
  "iv": "base64...",
  "authTag": "base64...",
  "ciphertext": "base64..."
}
```

- **Cipher**: AES-256-GCM (`node:crypto` `createCipheriv`/`createDecipheriv`),
  a fresh random 12-byte IV per encryption, GCM auth tag stored alongside
  the ciphertext and verified on decrypt (tampering with any field throws).
- **Key derivation**: `scryptSync(passphrase, salt, 32)` with a fresh random
  16-byte salt per file, cost params `N=16384, r=8, p=1`.
- **Passphrase source**: the `DOTFILES_SYNC_PASSPHRASE` env var is read
  first; if unset, you're prompted interactively via `node:readline`.
  **The interactive prompt does NOT hide/mask your input** -- it's a
  best-effort fallback only. For real use (and always in CI), set the env
  var instead. See `.env.example`.
- Plaintext secret content and the passphrase are **never** written into the
  repo directory -- only the ciphertext envelope lives there. Plaintext is
  written solely to each entry's `target` during `link`.

## Windows symlink caveat

Creating **file** symlinks on Windows requires either Administrator
privileges or Developer Mode enabled. `dotfiles-sync` always attempts a real
symlink first:

- **Directories** use the `'junction'` symlink type, which does **not**
  require elevated privileges and works out of the box.
- **Files** attempt a real `'file'` symlink. If that throws an
  `EPERM`/`EACCES` permission error, `dotfiles-sync` **falls back to a real
  file copy** and prints a warning that a copy (not a live symlink) was
  used. A copy will not automatically pick up further edits to the repo
  source -- re-run `link` after editing the repo copy to refresh it.

On Linux/macOS, real POSIX symlinks (`fs.symlinkSync`) are always used for
both files and directories; no fallback is needed.

## Tests

```sh
pnpm --filter @kasap/dotfiles-sync test
```

Tests use real temporary directories (`fs.mkdtempSync` under `os.tmpdir()`)
for manifest/link/status logic, and a real AES-256-GCM round trip (known
passphrase, tamper detection on ciphertext and auth tag) for the crypto
module. Windows-specific fallback behavior is only asserted inside
`if (process.platform === 'win32')` guards so the suite is meaningful on
both Windows and the `ubuntu-latest` CI runner.

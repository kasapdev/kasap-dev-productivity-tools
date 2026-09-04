#!/usr/bin/env node
import { Command } from "commander";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { encryptFile, resolvePassphrase } from "./crypto.js";
import {
  linkEntry,
  linkSecretEntry,
  statusEntry,
  unlinkEntry,
  unlinkSecretEntry,
} from "./linker.js";
import type { EntryStatus } from "./linker.js";
import {
  defaultManifestPath,
  defaultRepoDir,
  loadManifest,
  resolveSourcePath,
} from "./manifest.js";
import type { Manifest } from "./manifest.js";

const program = new Command();

program
  .name("dotfiles-sync")
  .description("Sync dotfiles between a central repo and your home directory via real symlinks")
  .version("0.1.0");

interface RepoOpts {
  repo?: string;
  manifest?: string;
}

function resolveRepoAndManifest(opts: RepoOpts): { repoDir: string; manifestPath: string } {
  const repoDir = opts.repo ? resolve(opts.repo) : defaultRepoDir();
  const manifestPath = opts.manifest ? resolve(opts.manifest) : defaultManifestPath(repoDir);
  return { repoDir, manifestPath };
}

function loadManifestOrExit(manifestPath: string): Manifest {
  try {
    return loadManifest(manifestPath);
  } catch (err) {
    console.error(`error: ${(err as Error).message}`);
    process.exit(1);
  }
}

function basenameNoDir(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] ?? p;
}

function formatStatusTable(statuses: EntryStatus[]): string {
  const nameWidth = Math.max(4, ...statuses.map((s) => s.entry.name.length));
  const stateWidth = Math.max(5, ...statuses.map((s) => s.state.length));
  const header = `${"NAME".padEnd(nameWidth)}  ${"STATE".padEnd(stateWidth)}  DETAIL`;
  const divider = `${"-".repeat(nameWidth)}  ${"-".repeat(stateWidth)}  ${"-".repeat(6)}`;
  const rows = statuses.map(
    (s) => `${s.entry.name.padEnd(nameWidth)}  ${s.state.padEnd(stateWidth)}  ${s.detail}`
  );
  return [header, divider, ...rows].join("\n");
}

program
  .command("link")
  .description("Create/refresh symlinks (or decrypt secrets) for every manifest entry")
  .option("--repo <dir>", "path to the dotfiles repo dir (default: ~/.dotfiles)")
  .option("--manifest <path>", "path to dotfiles.json (default: <repo>/dotfiles.json)")
  .action(async (opts: RepoOpts) => {
    const { repoDir, manifestPath } = resolveRepoAndManifest(opts);
    const manifest = loadManifestOrExit(manifestPath);
    const hasSecrets = manifest.entries.some((e) => e.secret === true);
    const passphrase = hasSecrets ? await resolvePassphrase() : undefined;

    let failures = 0;
    for (const entry of manifest.entries) {
      try {
        if (entry.secret === true) {
          linkSecretEntry(entry, repoDir, passphrase as string);
        } else {
          linkEntry(entry, repoDir);
        }
      } catch (err) {
        failures += 1;
        console.error(`error: ${(err as Error).message}`);
      }
    }
    if (failures > 0) process.exitCode = 1;
  });

program
  .command("unlink")
  .description("Remove managed symlinks/copies (or decrypted secrets) for every manifest entry")
  .option("--repo <dir>", "path to the dotfiles repo dir (default: ~/.dotfiles)")
  .option("--manifest <path>", "path to dotfiles.json (default: <repo>/dotfiles.json)")
  .action((opts: RepoOpts) => {
    const { repoDir, manifestPath } = resolveRepoAndManifest(opts);
    const manifest = loadManifestOrExit(manifestPath);
    const passphrase = process.env.DOTFILES_SYNC_PASSPHRASE;

    for (const entry of manifest.entries) {
      if (entry.secret === true) {
        unlinkSecretEntry(entry, repoDir, passphrase);
      } else {
        unlinkEntry(entry, repoDir);
      }
    }
  });

program
  .command("status")
  .description("Report the link status (linked/missing/diverged) of every manifest entry")
  .option("--repo <dir>", "path to the dotfiles repo dir (default: ~/.dotfiles)")
  .option("--manifest <path>", "path to dotfiles.json (default: <repo>/dotfiles.json)")
  .action((opts: RepoOpts) => {
    const { repoDir, manifestPath } = resolveRepoAndManifest(opts);
    const manifest = loadManifestOrExit(manifestPath);
    const statuses = manifest.entries.map((entry) => statusEntry(entry, repoDir));
    console.log(formatStatusTable(statuses));
    const diverged = statuses.filter((s) => s.state === "diverged").length;
    if (diverged > 0) process.exitCode = 1;
  });

program
  .command("encrypt")
  .description("Encrypt a plaintext file into an AES-256-GCM envelope inside the repo")
  .argument("<file>", "path to the plaintext file to encrypt")
  .option("--repo <dir>", "path to the dotfiles repo dir (default: ~/.dotfiles)")
  .option("--out <relativePath>", "destination path inside the repo (default: <basename>.enc)")
  .action(async (file: string, opts: { repo?: string; out?: string }) => {
    const repoDir = opts.repo ? resolve(opts.repo) : defaultRepoDir();
    const srcPath = resolve(file);
    if (!existsSync(srcPath)) {
      console.error(`error: file not found: ${srcPath}`);
      process.exitCode = 1;
      return;
    }
    const outRelative = opts.out ?? `${basenameNoDir(srcPath)}.enc`;
    const destPath = resolveSourcePath(repoDir, outRelative);
    mkdirSync(dirname(destPath), { recursive: true });

    const passphrase = await resolvePassphrase();
    encryptFile(srcPath, destPath, passphrase);
    console.log(`encrypted ${srcPath} -> ${destPath}`);
    console.log(`Add this to your manifest: { "source": ${JSON.stringify(outRelative)}, "secret": true, ... }`);
  });

await program.parseAsync(process.argv);

#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { closeDatabase, getDefaultDbPath, initDatabase } from "./db.js";
import { copyToClipboard } from "./clipboard.js";
import {
  deleteSnippet,
  getSnippet,
  listSnippets,
  saveSnippet,
  searchSnippets,
} from "./store.js";

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", (err) => reject(err));
  });
}

function parseTags(tags: string | undefined): string[] {
  if (!tags) return [];
  return tags
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function padEnd(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

const program = new Command();

program
  .name("snippet-vault")
  .description("A personal CLI snippet manager backed by node:sqlite")
  .version("0.1.0")
  .option("--db <path>", "path to the sqlite database file");

function resolveDbPath(): string {
  const opts = program.opts<{ db?: string }>();
  return opts.db ?? getDefaultDbPath();
}

program
  .command("save")
  .description("Save (or overwrite) a snippet by name")
  .argument("<name>", "snippet name")
  .option("--lang <lang>", "language tag for the snippet")
  .option("--tags <tags>", "comma-separated tags")
  .option("--file <path>", "read content from a file instead of stdin")
  .action(async (name: string, opts: { lang?: string; tags?: string; file?: string }) => {
    const content = opts.file ? readFileSync(opts.file, "utf8") : await readStdin();

    const db = initDatabase(resolveDbPath());
    try {
      const result = saveSnippet(db, {
        name,
        content,
        lang: opts.lang ?? null,
        tags: parseTags(opts.tags),
      });
      if (result.replaced) {
        console.log(`Replaced existing snippet "${name}".`);
      } else {
        console.log(`Saved snippet "${name}".`);
      }
    } finally {
      closeDatabase();
    }
  });

program
  .command("get")
  .description("Print a snippet's content and copy it to the clipboard")
  .argument("<name>", "snippet name")
  .action(async (name: string) => {
    const db = initDatabase(resolveDbPath());
    let snippet;
    try {
      snippet = getSnippet(db, name);
    } finally {
      closeDatabase();
    }

    if (!snippet) {
      console.error(`No snippet named "${name}" exists.`);
      process.exitCode = 1;
      return;
    }

    console.log(snippet.content);

    const copied = await copyToClipboard(snippet.content);
    if (!copied) {
      console.error("Warning: clipboard copy unavailable on this platform/environment.");
    }
  });

program
  .command("search")
  .description("Search snippets by substring across name, content, and tags")
  .argument("<query>", "search text")
  .option("--tag <tag>", "further filter to snippets with this exact tag")
  .action((query: string, opts: { tag?: string }) => {
    const db = initDatabase(resolveDbPath());
    let results;
    try {
      results = searchSnippets(db, query, { tag: opts.tag });
    } finally {
      closeDatabase();
    }

    if (results.length === 0) {
      console.log("No matching snippets found.");
      return;
    }

    for (const snippet of results) {
      console.log(
        `${snippet.name}\t${snippet.lang ?? ""}\t${snippet.tags.join(",")}\t${snippet.updated_at}`
      );
    }
  });

program
  .command("list")
  .description("List all saved snippets")
  .action(() => {
    const db = initDatabase(resolveDbPath());
    let snippets;
    try {
      snippets = listSnippets(db);
    } finally {
      closeDatabase();
    }

    if (snippets.length === 0) {
      console.log("No snippets saved yet.");
      return;
    }

    const nameWidth = Math.max(4, ...snippets.map((s) => s.name.length));
    const langWidth = Math.max(4, ...snippets.map((s) => (s.lang ?? "").length));

    console.log(`${padEnd("NAME", nameWidth)}  ${padEnd("LANG", langWidth)}  TAGS\tUPDATED_AT`);
    for (const s of snippets) {
      console.log(
        `${padEnd(s.name, nameWidth)}  ${padEnd(s.lang ?? "", langWidth)}  ${s.tags.join(",")}\t${s.updated_at}`
      );
    }
  });

program
  .command("delete")
  .description("Delete a snippet by name")
  .argument("<name>", "snippet name")
  .action((name: string) => {
    const db = initDatabase(resolveDbPath());
    try {
      deleteSnippet(db, name);
      console.log(`Deleted snippet "${name}".`);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    } finally {
      closeDatabase();
    }
  });

await program.parseAsync(process.argv);

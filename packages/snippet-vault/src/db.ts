import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

let db: DatabaseSync | null = null;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS snippets (
    name TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    lang TEXT,
    tags TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

/**
 * Default DB path: ~/.snippet-vault/snippets.sqlite
 * Overridable via SNIPPET_VAULT_DB_PATH env var or an explicit path passed
 * to initDatabase (e.g. from the --db CLI flag).
 */
export function getDefaultDbPath(): string {
  const fromEnv = process.env["SNIPPET_VAULT_DB_PATH"];
  if (fromEnv) {
    return fromEnv;
  }
  return join(homedir(), ".snippet-vault", "snippets.sqlite");
}

export function initDatabase(dbPath: string): DatabaseSync {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  return db;
}

export function getDatabase(): DatabaseSync {
  if (!db) throw new Error("Database not initialized. Call initDatabase(dbPath) first.");
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

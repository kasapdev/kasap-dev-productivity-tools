import type { DatabaseSync } from "node:sqlite";

export interface Snippet {
  name: string;
  content: string;
  lang: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

interface SnippetRow {
  name: string;
  content: string;
  lang: string | null;
  tags: string;
  created_at: string;
  updated_at: string;
}

export interface SaveSnippetInput {
  name: string;
  content: string;
  lang?: string | null;
  tags?: string[];
}

export interface SaveSnippetResult {
  /** true if an existing snippet with this name was overwritten */
  replaced: boolean;
}

function tagsToString(tags: string[] | undefined): string {
  if (!tags || tags.length === 0) return "";
  const cleaned = tags
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return cleaned.join(",");
}

function rowToSnippet(row: SnippetRow): Snippet {
  return {
    name: row.name,
    content: row.content,
    lang: row.lang,
    tags: row.tags.length > 0 ? row.tags.split(",") : [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Escapes LIKE wildcard characters (% and _) so substring search is literal. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export function saveSnippet(db: DatabaseSync, input: SaveSnippetInput): SaveSnippetResult {
  const existing = db.prepare("SELECT name FROM snippets WHERE name = ?").get(input.name);

  const now = new Date().toISOString();
  const tags = tagsToString(input.tags);
  const lang = input.lang ?? null;

  if (existing) {
    db.prepare(
      `UPDATE snippets SET content = ?, lang = ?, tags = ?, updated_at = ? WHERE name = ?`
    ).run(input.content, lang, tags, now, input.name);
    return { replaced: true };
  }

  db.prepare(
    `INSERT INTO snippets (name, content, lang, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(input.name, input.content, lang, tags, now, now);
  return { replaced: false };
}

export function getSnippet(db: DatabaseSync, name: string): Snippet | undefined {
  const row = db.prepare("SELECT * FROM snippets WHERE name = ?").get(name);
  return row ? rowToSnippet(row as unknown as SnippetRow) : undefined;
}

export function listSnippets(db: DatabaseSync): Snippet[] {
  const rows = db.prepare("SELECT * FROM snippets ORDER BY name ASC").all();
  return rows.map((row) => rowToSnippet(row as unknown as SnippetRow));
}

export interface SearchOptions {
  tag?: string;
}

/**
 * Case-insensitive substring search across name, content, and tags.
 * Uses SQL LIKE with bound parameters (wildcards escaped so the query
 * text itself is matched literally). An optional exact tag filter is
 * applied afterwards against the parsed tags array.
 */
export function searchSnippets(
  db: DatabaseSync,
  query: string,
  options: SearchOptions = {}
): Snippet[] {
  const pattern = `%${escapeLike(query)}%`;
  const rows = db
    .prepare(
      `SELECT * FROM snippets
       WHERE name LIKE ? ESCAPE '\\'
          OR content LIKE ? ESCAPE '\\'
          OR tags LIKE ? ESCAPE '\\'
       ORDER BY name ASC`
    )
    .all(pattern, pattern, pattern);

  let snippets = rows.map((row) => rowToSnippet(row as unknown as SnippetRow));

  if (options.tag) {
    const tagFilter = options.tag;
    snippets = snippets.filter((s) => s.tags.includes(tagFilter));
  }

  return snippets;
}

/**
 * Deletes a snippet by name. Throws an Error if no snippet with that
 * name exists, so callers (e.g. the CLI) can report a clear failure.
 */
export function deleteSnippet(db: DatabaseSync, name: string): void {
  const result = db.prepare("DELETE FROM snippets WHERE name = ?").run(name);
  if (result.changes === 0) {
    throw new Error(`No snippet named "${name}" exists.`);
  }
}

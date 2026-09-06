import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { closeDatabase, initDatabase } from "../src/db.js";
import {
  deleteSnippet,
  getSnippet,
  listSnippets,
  saveSnippet,
  searchSnippets,
} from "../src/store.js";

function tempDbPath(): string {
  return join(tmpdir(), `snippet-vault-test-${Date.now()}-${Math.random()}.sqlite`);
}

describe("store", () => {
  let dbPath: string;
  let db: DatabaseSync;

  beforeEach(() => {
    dbPath = tempDbPath();
    db = initDatabase(dbPath);
  });

  afterEach(() => {
    closeDatabase();
    if (existsSync(dbPath)) rmSync(dbPath);
    if (existsSync(`${dbPath}-wal`)) rmSync(`${dbPath}-wal`);
    if (existsSync(`${dbPath}-shm`)) rmSync(`${dbPath}-shm`);
  });

  it("saves and retrieves a snippet round trip", () => {
    const result = saveSnippet(db, {
      name: "hello",
      content: "console.log('hi')",
      lang: "ts",
      tags: ["greeting", "demo"],
    });
    expect(result.replaced).toBe(false);

    const snippet = getSnippet(db, "hello");
    expect(snippet).toBeDefined();
    expect(snippet?.name).toBe("hello");
    expect(snippet?.content).toBe("console.log('hi')");
    expect(snippet?.lang).toBe("ts");
    expect(snippet?.tags).toEqual(["greeting", "demo"]);
    expect(snippet?.created_at).toBeTruthy();
    expect(snippet?.updated_at).toBeTruthy();
  });

  it("upserts (overwrites) an existing snippet by name", () => {
    saveSnippet(db, { name: "hello", content: "v1", lang: "ts", tags: ["a"] });
    const result = saveSnippet(db, { name: "hello", content: "v2", lang: "js", tags: ["b", "c"] });

    expect(result.replaced).toBe(true);

    const snippet = getSnippet(db, "hello");
    expect(snippet?.content).toBe("v2");
    expect(snippet?.lang).toBe("js");
    expect(snippet?.tags).toEqual(["b", "c"]);

    // only one row should exist for this name
    expect(listSnippets(db)).toHaveLength(1);
  });

  it("returns undefined for a snippet that does not exist", () => {
    expect(getSnippet(db, "nope")).toBeUndefined();
  });

  it("searches by substring in name", () => {
    saveSnippet(db, { name: "react-hook", content: "useState()", lang: "tsx", tags: [] });
    saveSnippet(db, { name: "vue-composable", content: "ref()", lang: "ts", tags: [] });

    const results = searchSnippets(db, "react");
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("react-hook");
  });

  it("searches by substring in content, case-insensitively", () => {
    saveSnippet(db, { name: "a", content: "This is a Special Marker string", lang: null, tags: [] });
    saveSnippet(db, { name: "b", content: "nothing interesting here", lang: null, tags: [] });

    const results = searchSnippets(db, "special marker");
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("a");
  });

  it("searches by substring in tags", () => {
    saveSnippet(db, { name: "a", content: "x", lang: null, tags: ["backend", "sql"] });
    saveSnippet(db, { name: "b", content: "y", lang: null, tags: ["frontend"] });

    const results = searchSnippets(db, "back");
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("a");
  });

  it("returns an empty array when nothing matches", () => {
    saveSnippet(db, { name: "a", content: "x", lang: null, tags: [] });
    expect(searchSnippets(db, "zzz-no-match-zzz")).toEqual([]);
  });

  it("treats SQL LIKE wildcard characters in the query as literal text", () => {
    // "%" and "_" are LIKE metacharacters; a naive implementation that fails
    // to escape them would treat a literal "50%" query as "50" + wildcard,
    // spuriously matching content that merely starts with "50".
    saveSnippet(db, { name: "a", content: "progress: 50% done", lang: null, tags: [] });
    saveSnippet(db, { name: "b", content: "progress: 5000 done (no percent)", lang: null, tags: [] });

    const percentResults = searchSnippets(db, "50%");
    expect(percentResults.map((s) => s.name)).toEqual(["a"]);

    // "_" is the LIKE single-character wildcard. If it were left unescaped,
    // querying "c_t" would also match "cat" and "cot" via wildcard
    // expansion. None of the saved snippets contain a literal "c_t", so a
    // correctly-escaped search must return no results at all.
    saveSnippet(db, { name: "c", content: "cat", lang: null, tags: [] });
    saveSnippet(db, { name: "d", content: "cot", lang: null, tags: [] });
    const underscoreResults = searchSnippets(db, "c_t");
    expect(underscoreResults).toEqual([]);
  });

  it("filters search results by an exact tag", () => {
    saveSnippet(db, { name: "a", content: "shared text", lang: null, tags: ["python"] });
    saveSnippet(db, { name: "b", content: "shared text", lang: null, tags: ["javascript"] });

    const results = searchSnippets(db, "shared", { tag: "python" });
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("a");
  });

  it("lists all saved snippets", () => {
    saveSnippet(db, { name: "one", content: "1", lang: null, tags: [] });
    saveSnippet(db, { name: "two", content: "2", lang: null, tags: [] });
    saveSnippet(db, { name: "three", content: "3", lang: null, tags: [] });

    const all = listSnippets(db);
    expect(all.map((s) => s.name).sort()).toEqual(["one", "three", "two"]);
  });

  it("deletes a snippet so it is no longer found by get or search", () => {
    saveSnippet(db, { name: "temp", content: "delete me", lang: null, tags: ["throwaway"] });
    expect(getSnippet(db, "temp")).toBeDefined();

    deleteSnippet(db, "temp");

    expect(getSnippet(db, "temp")).toBeUndefined();
    expect(searchSnippets(db, "delete me")).toEqual([]);
    expect(listSnippets(db)).toEqual([]);
  });

  it("throws a clear error when deleting a nonexistent snippet", () => {
    expect(() => deleteSnippet(db, "does-not-exist")).toThrowError(/does-not-exist/);
  });
});

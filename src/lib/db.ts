import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export type Db = DatabaseSync;

let db: Db | null = null;

function schemaPath(): string {
  return join(process.cwd(), "src", "lib", "schema.sql");
}

function dbPath(): string {
  return process.env.SQLITE_PATH ?? join(process.cwd(), "data", "adaptquiz.db");
}

/** Open (and initialise) the SQLite DB. Safe to call per-request; singleton. */
export function getDb(): Db {
  if (db) return db;
  const path = dbPath();
  mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(readFileSync(schemaPath(), "utf8"));
  return db;
}

/** Create tables in a fresh :memory: DB — used by tests / verification. */
export function initMemoryDb(): Db {
  const mem = new DatabaseSync(":memory:");
  mem.exec("PRAGMA foreign_keys = ON;");
  mem.exec(readFileSync(schemaPath(), "utf8"));
  return mem;
}

export function newId(prefix = ""): string {
  return `${prefix}${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

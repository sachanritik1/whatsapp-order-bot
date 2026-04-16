import Database from "better-sqlite3";
import { Context, Effect, Layer } from "effect";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { AppConfigService } from "../config.js";
import { DatabaseError } from "../errors.js";

export type SqliteDatabase = InstanceType<typeof Database>;

const initializeDatabase = (db: SqliteDatabase) => {
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS inbound_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      text TEXT NOT NULL,
      message_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      received_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_sessions (
      phone TEXT PRIMARY KEY,
      name TEXT,
      product TEXT,
      quantity INTEGER,
      city_or_pincode TEXT,
      selected_product_id TEXT,
      candidate_product_ids TEXT NOT NULL DEFAULT '[]',
      missing_fields TEXT NOT NULL DEFAULT '[]',
      last_asked_follow_up TEXT,
      clarification_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_message_id TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL,
      name TEXT NOT NULL,
      product TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      city_or_pincode TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const existingColumns = db
    .prepare("PRAGMA table_info(order_sessions)")
    .all() as ReadonlyArray<{ readonly name: string }>;
  const columnNames = new Set(existingColumns.map((column) => column.name));

  const maybeAddColumn = (name: string, sql: string) => {
    if (!columnNames.has(name)) {
      db.exec(`ALTER TABLE order_sessions ADD COLUMN ${sql}`);
    }
  };

  maybeAddColumn("selected_product_id", "selected_product_id TEXT");
  maybeAddColumn(
    "candidate_product_ids",
    "candidate_product_ids TEXT NOT NULL DEFAULT '[]'"
  );
  maybeAddColumn("missing_fields", "missing_fields TEXT NOT NULL DEFAULT '[]'");
  maybeAddColumn("last_asked_follow_up", "last_asked_follow_up TEXT");
  maybeAddColumn(
    "clarification_count",
    "clarification_count INTEGER NOT NULL DEFAULT 0"
  );

  const leadColumns = db
    .prepare("PRAGMA table_info(leads)")
    .all() as ReadonlyArray<{ readonly name: string }>;
  const leadColumnNames = new Set(leadColumns.map((column) => column.name));

  if (!leadColumnNames.has("source_message_id")) {
    db.exec("ALTER TABLE leads ADD COLUMN source_message_id TEXT");
    db.exec(`
      UPDATE leads
      SET source_message_id = 'legacy-' || id
      WHERE source_message_id IS NULL
    `);
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS leads_source_message_id_idx ON leads(source_message_id)");
  }
};

export const DatabaseClient = Context.GenericTag<SqliteDatabase>("DatabaseClient");

export const DatabaseClientLive = Layer.scoped(
  DatabaseClient,
  Effect.acquireRelease(
    Effect.gen(function* () {
      const config = yield* AppConfigService;

      yield* Effect.tryPromise({
        try: () => mkdir(dirname(config.databaseFile), { recursive: true }),
        catch: (cause) =>
          new DatabaseError({
            message: "Unable to create database directory.",
            cause
          })
      });

      const db = yield* Effect.try({
        try: () => new Database(config.databaseFile),
        catch: (cause) =>
          new DatabaseError({
            message: "Unable to open SQLite database.",
            cause
          })
      });

      yield* Effect.try({
        try: () => initializeDatabase(db),
        catch: (cause) =>
          new DatabaseError({
            message: "Unable to initialize SQLite schema.",
            cause
          })
      });

      return db;
    }),
    (db) =>
      Effect.sync(() => {
        db.close();
      })
  )
);

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { Context, Effect, Layer } from "effect";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { AppConfigService } from "../config.js";
import { DatabaseError } from "../errors.js";
import { drizzleSchema } from "./db-schema.js";

export type SqliteDatabase = InstanceType<typeof Database>;
export type DrizzleDatabase = ReturnType<typeof drizzle<typeof drizzleSchema>>;
export interface DatabaseService {
  readonly sqlite: SqliteDatabase;
  readonly drizzle: DrizzleDatabase;
}

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
const journalPath = fileURLToPath(new URL("../../drizzle/meta/_journal.json", import.meta.url));

const maybeBaselineExistingDatabase = async (db: SqliteDatabase) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )
  `);

  const migrationCount = db
    .prepare("SELECT COUNT(*) AS count FROM __drizzle_migrations")
    .get() as { readonly count: number };

  if (migrationCount.count > 0) {
    return;
  }

  const existingTables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as ReadonlyArray<{ readonly name: string }>;
  const tableNames = new Set(existingTables.map((row) => row.name));
  const hasExistingAppSchema =
    tableNames.has("inbound_events") &&
    tableNames.has("order_sessions") &&
    tableNames.has("leads");

  if (!hasExistingAppSchema) {
    return;
  }

  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    readonly entries: ReadonlyArray<{
      readonly tag: string;
      readonly when: number;
    }>;
  };
  const firstMigration = journal.entries[0];

  if (!firstMigration) {
    return;
  }

  const migrationFilePath = fileURLToPath(
    new URL(`../../drizzle/${firstMigration.tag}.sql`, import.meta.url)
  );
  const migrationSql = await readFile(migrationFilePath, "utf8");
  const hash = createHash("sha256").update(migrationSql).digest("hex");

  db.prepare(
    `INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES (?, ?)`
  ).run(hash, firstMigration.when);
};

const formatMigrationErrorMessage = (cause: unknown) => {
  const message = cause instanceof Error ? cause.message : String(cause);

  if (message.includes("already exists")) {
    return "Unable to apply SQLite migrations. The local SQLite file is out of sync with the Drizzle migration journal. If auto-baselining did not resolve it, run `npm run db:flush` once.";
  }

  return "Unable to apply SQLite migrations.";
};

export const DatabaseClient = Context.GenericTag<DatabaseService>("DatabaseClient");

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

      const drizzleDb = drizzle(db, { schema: drizzleSchema });

      yield* Effect.tryPromise({
        try: () => maybeBaselineExistingDatabase(db),
        catch: (cause) =>
          new DatabaseError({
            message: "Unable to baseline existing SQLite database for Drizzle migrations.",
            cause
          })
      });

      yield* Effect.try({
        try: () => migrate(drizzleDb, { migrationsFolder }),
        catch: (cause) =>
          new DatabaseError({
            message: formatMigrationErrorMessage(cause),
            cause
          })
      });

      return {
        sqlite: db,
        drizzle: drizzleDb
      };
    }),
    (database) =>
      Effect.sync(() => {
        database.sqlite.close();
      })
  )
);

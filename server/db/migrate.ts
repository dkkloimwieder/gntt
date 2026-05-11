/**
 * Apply Drizzle migrations against the on-disk DB.
 *
 * Run via `pnpm db:migrate`. Idempotent — already-applied migrations
 * are skipped. Creates the `data/` directory + DB file if missing.
 */
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

const dbPath = process.env.GANTT_DB_PATH ?? './data/gantt.db';
const dir = dirname(dbPath);
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

const raw = new Database(dbPath);
raw.pragma('foreign_keys = ON');
const db = drizzle(raw);

migrate(db, { migrationsFolder: './server/migrations' });

console.log(`✓ migrations applied to ${dbPath}`);
raw.close();

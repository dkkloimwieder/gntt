/**
 * Shared DB client wrapper — single Drizzle instance per Node process.
 * In-memory variant exposed for tests so each test gets a hermetic DB.
 */
import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type DB = BetterSQLite3Database<typeof schema>;

let cached: DB | null = null;
let cachedRaw: Database.Database | null = null;

/** Open (or reuse) the on-disk DB at `data/gantt.db`. */
export function openDb(filePath = './data/gantt.db'): DB {
    if (cached) return cached;
    cachedRaw = new Database(filePath);
    cachedRaw.pragma('journal_mode = WAL');
    cachedRaw.pragma('foreign_keys = ON');
    cached = drizzle(cachedRaw, { schema });
    return cached;
}

/** Open a hermetic in-memory DB (for tests). Caller owns the lifecycle. */
export function openInMemoryDb(): { db: DB; raw: Database.Database } {
    const raw = new Database(':memory:');
    raw.pragma('foreign_keys = ON');
    const db = drizzle(raw, { schema });
    return { db, raw };
}

/** Close the cached process-wide DB (mostly for graceful shutdown). */
export function closeDb(): void {
    if (cachedRaw) {
        cachedRaw.close();
        cachedRaw = null;
        cached = null;
    }
}

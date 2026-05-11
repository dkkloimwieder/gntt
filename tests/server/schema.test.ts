import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import {
    blockedTime,
    dependencies,
    resources,
    tasks,
} from '../../server/db/schema';

/**
 * Hermetic schema tests — each case spins up a fresh in-memory DB,
 * applies the migrations, and exercises CRUD. No file I/O.
 */

function freshDb() {
    const raw = new Database(':memory:');
    raw.pragma('foreign_keys = ON');
    const db = drizzle(raw);
    migrate(db, { migrationsFolder: './server/migrations' });
    return { db, raw };
}

describe('schema migrations', () => {
    it('creates all four tables idempotently', () => {
        const { raw } = freshDb();
        const tableNames = (
            raw
                .prepare(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'",
                )
                .all() as Array<{ name: string }>
        )
            .map((r) => r.name)
            .sort();
        expect(tableNames).toContain('tasks');
        expect(tableNames).toContain('resources');
        expect(tableNames).toContain('dependencies');
        expect(tableNames).toContain('blocked_time');
        raw.close();
    });
});

describe('resources CRUD', () => {
    it('insert + select', () => {
        const { db, raw } = freshDb();
        db.insert(resources).values({ id: 'alice', name: 'Alice' }).run();
        const rows = db.select().from(resources).all();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.id).toBe('alice');
        expect(rows[0]!.name).toBe('Alice');
        expect(rows[0]!.sortOrder).toBe(0);
        raw.close();
    });
});

describe('tasks CRUD', () => {
    it('insert + update + select', () => {
        const { db, raw } = freshDb();
        db.insert(tasks)
            .values({
                id: 't1',
                name: 'Task 1',
                start: '2025-01-01 08:00',
                end: '2025-01-01 16:00',
                progress: 0,
            })
            .run();
        db.update(tasks).set({ progress: 50 }).where(eq(tasks.id, 't1')).run();
        const t = db.select().from(tasks).all()[0]!;
        expect(t.progress).toBe(50);
        expect(t.name).toBe('Task 1');
        raw.close();
    });

    it('JSON constraints column round-trips', () => {
        const { db, raw } = freshDb();
        db.insert(tasks)
            .values({
                id: 't1',
                name: 'Task 1',
                start: '2025-01-01 08:00',
                end: '2025-01-01 16:00',
                constraints: JSON.stringify({
                    locked: true,
                    minStart: '2024-12-01 00:00',
                }),
            })
            .run();
        const row = db.select().from(tasks).all()[0]!;
        const parsed = JSON.parse(row.constraints!);
        expect(parsed.locked).toBe(true);
        expect(parsed.minStart).toBe('2024-12-01 00:00');
        raw.close();
    });
});

describe('dependencies CRUD + cascade', () => {
    it('cascades on parent task delete', () => {
        const { db, raw } = freshDb();
        db.insert(tasks)
            .values([
                {
                    id: 't1',
                    name: 'A',
                    start: '2025-01-01 08:00',
                    end: '2025-01-01 16:00',
                },
                {
                    id: 't2',
                    name: 'B',
                    start: '2025-01-02 08:00',
                    end: '2025-01-02 16:00',
                },
            ])
            .run();
        db.insert(dependencies)
            .values({ fromTaskId: 't1', toTaskId: 't2', type: 'FS', lag: 0 })
            .run();
        expect(db.select().from(dependencies).all()).toHaveLength(1);

        db.delete(tasks).where(eq(tasks.id, 't1')).run();
        expect(db.select().from(dependencies).all()).toHaveLength(0);
        raw.close();
    });

    it('default type=FS, lag=0', () => {
        const { db, raw } = freshDb();
        db.insert(tasks)
            .values([
                {
                    id: 't1',
                    name: 'A',
                    start: '2025-01-01 08:00',
                    end: '2025-01-01 16:00',
                },
                {
                    id: 't2',
                    name: 'B',
                    start: '2025-01-02 08:00',
                    end: '2025-01-02 16:00',
                },
            ])
            .run();
        db.insert(dependencies)
            .values({ fromTaskId: 't1', toTaskId: 't2' })
            .run();
        const dep = db.select().from(dependencies).all()[0]!;
        expect(dep.type).toBe('FS');
        expect(dep.lag).toBe(0);
        expect(dep.maxGap).toBeNull();
        raw.close();
    });
});

describe('blocked_time CRUD + cascade', () => {
    it('insert + delete-cascade-with-resource', () => {
        const { db, raw } = freshDb();
        db.insert(resources).values({ id: 'alice', name: 'Alice' }).run();
        db.insert(blockedTime)
            .values({
                resourceId: 'alice',
                start: '2025-01-15 08:00',
                end: '2025-01-15 17:00',
                reason: 'Holiday',
            })
            .run();
        expect(db.select().from(blockedTime).all()).toHaveLength(1);

        db.delete(resources).where(eq(resources.id, 'alice')).run();
        expect(db.select().from(blockedTime).all()).toHaveLength(0);
        raw.close();
    });
});

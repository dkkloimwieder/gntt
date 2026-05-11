import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import {
    blockedTime,
    dependencies,
    resources,
    tasks,
} from '../../server/db/schema';
import {
    PatchValidationError,
    TaskNotFoundError,
    loadBootstrap,
    patchTask,
} from '../../server/db/adapter';
import type { DB } from '../../server/db/client';

function freshDb(): { db: DB; close: () => void } {
    const raw = new Database(':memory:');
    raw.pragma('foreign_keys = ON');
    const db = drizzle(raw) as unknown as DB;
    migrate(db, { migrationsFolder: './server/migrations' });
    return { db, close: () => raw.close() };
}

describe('loadBootstrap', () => {
    let db: DB;
    let close: () => void;

    beforeEach(() => {
        ({ db, close } = freshDb());
    });

    it('returns empty bundle when DB is empty', () => {
        const bundle = loadBootstrap(db);
        expect(bundle).toEqual({
            tasks: [],
            resources: [],
            blockedTime: [],
        });
        close();
    });

    it('embeds dependencies inline on each task', () => {
        db.insert(tasks)
            .values([
                {
                    id: 'a',
                    name: 'A',
                    start: '2025-01-01 08:00',
                    end: '2025-01-01 16:00',
                },
                {
                    id: 'b',
                    name: 'B',
                    start: '2025-01-02 08:00',
                    end: '2025-01-02 16:00',
                },
            ])
            .run();
        db.insert(dependencies)
            .values({ fromTaskId: 'a', toTaskId: 'b', type: 'SS', lag: 4 })
            .run();

        const bundle = loadBootstrap(db);
        const b = bundle.tasks.find((t) => t.id === 'b')!;
        expect(b.dependencies).toEqual([{ id: 'a', type: 'SS', lag: 4 }]);
        const a = bundle.tasks.find((t) => t.id === 'a')!;
        expect(a.dependencies).toBeUndefined();
        close();
    });

    it('parses constraints JSON', () => {
        db.insert(tasks)
            .values({
                id: 'a',
                name: 'A',
                start: '2025-01-01 08:00',
                end: '2025-01-01 16:00',
                constraints: JSON.stringify({ locked: 'start' }),
            })
            .run();
        const bundle = loadBootstrap(db);
        expect(bundle.tasks[0]!.constraints).toEqual({ locked: 'start' });
        close();
    });

    it('drops constraints field when JSON is malformed', () => {
        db.insert(tasks)
            .values({
                id: 'a',
                name: 'A',
                start: '2025-01-01 08:00',
                end: '2025-01-01 16:00',
                constraints: '{not json',
            })
            .run();
        const bundle = loadBootstrap(db);
        expect(bundle.tasks[0]!.constraints).toBeUndefined();
        close();
    });

    it('attaches resource id under `resource` (not `resourceId`)', () => {
        db.insert(resources).values({ id: 'alice', name: 'Alice' }).run();
        db.insert(tasks)
            .values({
                id: 'a',
                name: 'A',
                start: '2025-01-01 08:00',
                end: '2025-01-01 16:00',
                resourceId: 'alice',
            })
            .run();
        const bundle = loadBootstrap(db);
        expect(bundle.tasks[0]!.resource).toBe('alice');
        // Confirm we don't leak the DB column name into the API.
        expect(
            (bundle.tasks[0] as unknown as Record<string, unknown>)[
                'resourceId'
            ],
        ).toBeUndefined();
        close();
    });

    it('returns blocked_time rows under `blockedTime`', () => {
        db.insert(resources).values({ id: 'alice', name: 'Alice' }).run();
        db.insert(blockedTime)
            .values({
                resourceId: 'alice',
                start: '2025-01-15 08:00',
                end: '2025-01-15 17:00',
                reason: 'Holiday',
            })
            .run();
        const bundle = loadBootstrap(db);
        expect(bundle.blockedTime).toHaveLength(1);
        expect(bundle.blockedTime[0]!).toMatchObject({
            resource: 'alice',
            start: '2025-01-15 08:00',
            end: '2025-01-15 17:00',
            reason: 'Holiday',
        });
        close();
    });
});

describe('patchTask', () => {
    let db: DB;
    let close: () => void;

    beforeEach(() => {
        ({ db, close } = freshDb());
        db.insert(tasks)
            .values({
                id: 'a',
                name: 'A',
                start: '2025-01-01 08:00',
                end: '2025-01-01 16:00',
                progress: 10,
            })
            .run();
    });

    it('updates allowed fields and returns chart-shape row', () => {
        const updated = patchTask(db, 'a', {
            progress: 75,
            name: 'A renamed',
        });
        expect(updated.progress).toBe(75);
        expect(updated.name).toBe('A renamed');
        // Confirm persistence
        const reread = loadBootstrap(db).tasks[0]!;
        expect(reread.progress).toBe(75);
        expect(reread.name).toBe('A renamed');
        close();
    });

    it('rejects disallowed fields with PatchValidationError', () => {
        expect(() => patchTask(db, 'a', { id: 'x' })).toThrow(
            PatchValidationError,
        );
        expect(() => patchTask(db, 'a', { updatedAt: 'now' })).toThrow(
            PatchValidationError,
        );
        close();
    });

    it('clamps + validates progress (0..100, numeric)', () => {
        expect(() => patchTask(db, 'a', { progress: -1 })).toThrow(
            PatchValidationError,
        );
        expect(() => patchTask(db, 'a', { progress: 101 })).toThrow(
            PatchValidationError,
        );
        expect(() => patchTask(db, 'a', { progress: 'fast' })).toThrow(
            PatchValidationError,
        );
        const ok = patchTask(db, 'a', { progress: 33.7 });
        expect(ok.progress).toBe(34); // rounded
        close();
    });

    it('throws TaskNotFoundError for unknown id', () => {
        expect(() => patchTask(db, 'no-such-id', { progress: 1 })).toThrow(
            TaskNotFoundError,
        );
        close();
    });

    it('writes resource via `resource` and reads back via `resource`', () => {
        db.insert(resources).values({ id: 'alice', name: 'Alice' }).run();
        const updated = patchTask(db, 'a', { resource: 'alice' });
        expect(updated.resource).toBe('alice');
        close();
    });

    it('serializes constraints back to JSON', () => {
        const updated = patchTask(db, 'a', {
            constraints: { locked: true },
        });
        expect(updated.constraints).toEqual({ locked: true });
        const reread = loadBootstrap(db).tasks[0]!;
        expect(reread.constraints).toEqual({ locked: true });
        close();
    });
});

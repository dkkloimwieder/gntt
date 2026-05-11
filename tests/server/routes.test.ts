import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { Hono } from 'hono';
import { tasks } from '../../server/db/schema';
import { bootstrapRoute } from '../../server/routes/bootstrap';
import { tasksRoute } from '../../server/routes/tasks';
import type { DB } from '../../server/db/client';

/**
 * Hono routes are exercised through `app.fetch(new Request(...))` —
 * no real HTTP listener, no port, fully hermetic. Each test gets its
 * own in-memory DB and a fresh app wired against it.
 */
function setup(): { app: Hono; db: DB; close: () => void } {
    const raw = new Database(':memory:');
    raw.pragma('foreign_keys = ON');
    const db = drizzle(raw) as unknown as DB;
    migrate(db, { migrationsFolder: './server/migrations' });

    const app = new Hono();
    app.route('/api', bootstrapRoute(db));
    app.route('/api', tasksRoute(db));
    return { app, db, close: () => raw.close() };
}

describe('GET /api/bootstrap', () => {
    it('returns 200 with empty bundle on a fresh DB', async () => {
        const { app, close } = setup();
        const res = await app.fetch(
            new Request('http://localhost/api/bootstrap'),
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({
            tasks: [],
            resources: [],
            blockedTime: [],
        });
        close();
    });

    it('returns seeded tasks', async () => {
        const { app, db, close } = setup();
        db.insert(tasks)
            .values({
                id: 'a',
                name: 'A',
                start: '2025-01-01 08:00',
                end: '2025-01-01 16:00',
            })
            .run();
        const res = await app.fetch(
            new Request('http://localhost/api/bootstrap'),
        );
        const body = await res.json();
        expect(body.tasks).toHaveLength(1);
        expect(body.tasks[0].id).toBe('a');
        close();
    });
});

describe('PATCH /api/tasks/:id', () => {
    let app: Hono;
    let db: DB;
    let close: () => void;

    beforeEach(() => {
        ({ app, db, close } = setup());
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

    const patch = (id: string, body: unknown) =>
        app.fetch(
            new Request(`http://localhost/api/tasks/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            }),
        );

    it('updates progress and returns the new row', async () => {
        const res = await patch('a', { progress: 50 });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.progress).toBe(50);
        close();
    });

    it('returns 400 for disallowed field', async () => {
        const res = await patch('a', { id: 'b' });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/not patchable/);
        close();
    });

    it('returns 400 for invalid progress', async () => {
        const res = await patch('a', { progress: 999 });
        expect(res.status).toBe(400);
        close();
    });

    it('returns 404 for unknown id', async () => {
        const res = await patch('no-such-id', { progress: 1 });
        expect(res.status).toBe(404);
        close();
    });

    it('returns 400 for malformed JSON body', async () => {
        const res = await app.fetch(
            new Request('http://localhost/api/tasks/a', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: '{not json',
            }),
        );
        expect(res.status).toBe(400);
        close();
    });

    it('returns 400 for non-object body (array)', async () => {
        const res = await patch('a', [1, 2, 3]);
        expect(res.status).toBe(400);
        close();
    });
});

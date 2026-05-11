import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { Hono } from 'hono';
import { resources, tasks } from '../../server/db/schema';
import { blockedRoute } from '../../server/routes/blocked';
import { bootstrapRoute } from '../../server/routes/bootstrap';
import { resourcesRoute } from '../../server/routes/resources';
import { tasksRoute } from '../../server/routes/tasks';
import type { DB } from '../../server/db/client';

/**
 * End-to-end CRUD coverage for the gantt-8az endpoints. Builds a fresh
 * in-memory DB + a Hono app per test, exercises POST/PATCH/PUT/DELETE
 * via app.fetch and verifies via GET /api/bootstrap that state actually
 * lands in the DB.
 */
function setup() {
    const raw = new Database(':memory:');
    raw.pragma('foreign_keys = ON');
    const db = drizzle(raw) as unknown as DB;
    migrate(db, { migrationsFolder: './server/migrations' });

    const app = new Hono();
    app.route('/api', bootstrapRoute(db));
    app.route('/api', tasksRoute(db));
    app.route('/api', resourcesRoute(db));
    app.route('/api', blockedRoute(db));
    return { app, db, close: () => raw.close() };
}

const json = (body: unknown): string => JSON.stringify(body);

const post = (app: Hono, path: string, body: unknown) =>
    app.fetch(
        new Request(`http://localhost${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: json(body),
        }),
    );

const put = (app: Hono, path: string, body: unknown) =>
    app.fetch(
        new Request(`http://localhost${path}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: json(body),
        }),
    );

const del = (app: Hono, path: string) =>
    app.fetch(new Request(`http://localhost${path}`, { method: 'DELETE' }));

const getBootstrap = async (app: Hono) => {
    const res = await app.fetch(new Request('http://localhost/api/bootstrap'));
    return res.json();
};

describe('POST /api/tasks', () => {
    let app: Hono;
    let close: () => void;
    beforeEach(() => ({ app, close } = setup()));

    it('creates a task with minimum fields', async () => {
        const res = await post(app, '/api/tasks', {
            id: 't1',
            name: 'Task One',
            start: '2025-01-01 09:00',
            end: '2025-01-01 17:00',
        });
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.id).toBe('t1');
        expect(body.progress).toBe(0);

        const bundle = await getBootstrap(app);
        expect(bundle.tasks).toHaveLength(1);
        close();
    });

    it('rejects missing required fields with 400', async () => {
        const res = await post(app, '/api/tasks', {
            id: 't1',
            name: 'Task One',
            // missing start/end
        });
        expect(res.status).toBe(400);
        close();
    });

    it('rejects duplicate id with 409', async () => {
        await post(app, '/api/tasks', {
            id: 't1',
            name: 'A',
            start: '2025-01-01 09:00',
            end: '2025-01-01 17:00',
        });
        const res = await post(app, '/api/tasks', {
            id: 't1',
            name: 'B',
            start: '2025-01-02 09:00',
            end: '2025-01-02 17:00',
        });
        expect(res.status).toBe(409);
        close();
    });

    it('accepts inline dependencies', async () => {
        await post(app, '/api/tasks', {
            id: 'a',
            name: 'A',
            start: '2025-01-01 09:00',
            end: '2025-01-01 17:00',
        });
        const res = await post(app, '/api/tasks', {
            id: 'b',
            name: 'B',
            start: '2025-01-02 09:00',
            end: '2025-01-02 17:00',
            dependencies: [{ id: 'a', type: 'FS', lag: 4 }],
        });
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.dependencies).toEqual([{ id: 'a', type: 'FS', lag: 4 }]);
        close();
    });
});

describe('DELETE /api/tasks/:id', () => {
    let app: Hono;
    let db: DB;
    let close: () => void;
    beforeEach(() => {
        ({ app, db, close } = setup());
        db.insert(tasks)
            .values({
                id: 't1',
                name: 'Task',
                start: '2025-01-01 09:00',
                end: '2025-01-01 17:00',
            })
            .run();
    });

    it('removes the row', async () => {
        const res = await del(app, '/api/tasks/t1');
        expect(res.status).toBe(200);
        const bundle = await getBootstrap(app);
        expect(bundle.tasks).toHaveLength(0);
        close();
    });

    it('returns 404 for unknown id', async () => {
        const res = await del(app, '/api/tasks/no-such');
        expect(res.status).toBe(404);
        close();
    });
});

describe('PUT /api/tasks/:id/dependencies', () => {
    let app: Hono;
    let db: DB;
    let close: () => void;
    beforeEach(() => {
        ({ app, db, close } = setup());
        db.insert(tasks)
            .values([
                {
                    id: 'a',
                    name: 'A',
                    start: '2025-01-01 09:00',
                    end: '2025-01-01 17:00',
                },
                {
                    id: 'b',
                    name: 'B',
                    start: '2025-01-02 09:00',
                    end: '2025-01-02 17:00',
                },
                {
                    id: 'c',
                    name: 'C',
                    start: '2025-01-03 09:00',
                    end: '2025-01-03 17:00',
                },
            ])
            .run();
    });

    it('replaces all incoming deps', async () => {
        // Start with one
        await put(app, '/api/tasks/c/dependencies', [
            { id: 'a', type: 'FS', lag: 0 },
        ]);
        let bundle = await getBootstrap(app);
        let c = bundle.tasks.find((t: { id: string }) => t.id === 'c');
        expect(c.dependencies).toHaveLength(1);

        // Replace with two
        await put(app, '/api/tasks/c/dependencies', [
            { id: 'a', type: 'SS', lag: 2 },
            { id: 'b', type: 'FS', lag: 0, max: 8 },
        ]);
        bundle = await getBootstrap(app);
        c = bundle.tasks.find((t: { id: string }) => t.id === 'c');
        expect(c.dependencies).toHaveLength(2);
        expect(c.dependencies).toContainEqual({
            id: 'a',
            type: 'SS',
            lag: 2,
        });
        expect(c.dependencies).toContainEqual({
            id: 'b',
            type: 'FS',
            lag: 0,
            max: 8,
        });

        // Replace with empty → no deps
        await put(app, '/api/tasks/c/dependencies', []);
        bundle = await getBootstrap(app);
        c = bundle.tasks.find((t: { id: string }) => t.id === 'c');
        expect(c.dependencies).toBeUndefined();
        close();
    });

    it('rejects self-dep with 400', async () => {
        const res = await put(app, '/api/tasks/a/dependencies', [
            { id: 'a', type: 'FS', lag: 0 },
        ]);
        expect(res.status).toBe(400);
        close();
    });

    it('rejects unknown predecessor with 400', async () => {
        const res = await put(app, '/api/tasks/c/dependencies', [
            { id: 'no-such', type: 'FS', lag: 0 },
        ]);
        expect(res.status).toBe(400);
        close();
    });

    it('returns 404 for unknown task', async () => {
        const res = await put(app, '/api/tasks/no-such/dependencies', []);
        expect(res.status).toBe(404);
        close();
    });

    it('rejects non-array body with 400', async () => {
        const res = await put(app, '/api/tasks/c/dependencies', {
            not: 'array',
        });
        expect(res.status).toBe(400);
        close();
    });
});

describe('POST/DELETE /api/resources', () => {
    let app: Hono;
    let close: () => void;
    beforeEach(() => ({ app, close } = setup()));

    it('creates and lists', async () => {
        const res = await post(app, '/api/resources', {
            id: 'alice',
            name: 'Alice',
        });
        expect(res.status).toBe(201);
        const bundle = await getBootstrap(app);
        expect(bundle.resources).toHaveLength(1);
        expect(bundle.resources[0].name).toBe('Alice');
        close();
    });

    it('rejects duplicate id with 409', async () => {
        await post(app, '/api/resources', { id: 'alice', name: 'Alice' });
        const res = await post(app, '/api/resources', {
            id: 'alice',
            name: 'Alice2',
        });
        expect(res.status).toBe(409);
        close();
    });

    it('deletes an existing resource', async () => {
        await post(app, '/api/resources', { id: 'alice', name: 'Alice' });
        const res = await del(app, '/api/resources/alice');
        expect(res.status).toBe(200);
        const bundle = await getBootstrap(app);
        expect(bundle.resources).toHaveLength(0);
        close();
    });

    it('returns 404 deleting unknown resource', async () => {
        const res = await del(app, '/api/resources/no-such');
        expect(res.status).toBe(404);
        close();
    });
});

describe('POST/DELETE /api/blocked', () => {
    let app: Hono;
    let db: DB;
    let close: () => void;
    beforeEach(() => {
        ({ app, db, close } = setup());
        db.insert(resources).values({ id: 'alice', name: 'Alice' }).run();
    });

    it('creates and lists', async () => {
        const res = await post(app, '/api/blocked', {
            resource: 'alice',
            start: '2025-01-15 08:00',
            end: '2025-01-15 17:00',
            reason: 'Holiday',
        });
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.id).toBeGreaterThan(0);
        const bundle = await getBootstrap(app);
        expect(bundle.blockedTime).toHaveLength(1);
        close();
    });

    it('rejects missing fields with 400', async () => {
        const res = await post(app, '/api/blocked', { resource: 'alice' });
        expect(res.status).toBe(400);
        close();
    });

    it('deletes by id', async () => {
        const created = await (
            await post(app, '/api/blocked', {
                resource: 'alice',
                start: '2025-01-15 08:00',
                end: '2025-01-15 17:00',
            })
        ).json();
        const res = await del(app, `/api/blocked/${created.id}`);
        expect(res.status).toBe(200);
        const bundle = await getBootstrap(app);
        expect(bundle.blockedTime).toHaveLength(0);
        close();
    });

    it('rejects non-numeric id with 400', async () => {
        const res = await del(app, '/api/blocked/abc');
        expect(res.status).toBe(400);
        close();
    });

    it('returns 404 for unknown id', async () => {
        const res = await del(app, '/api/blocked/9999');
        expect(res.status).toBe(404);
        close();
    });
});

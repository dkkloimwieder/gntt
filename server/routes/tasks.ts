import { Hono, type Context } from 'hono';
import type { DB } from '../db/client';
import {
    DuplicateTaskError,
    PatchValidationError,
    TaskNotFoundError,
    createTask,
    deleteTask,
    patchTask,
    replaceDependencies,
    type CreateTaskInput,
} from '../db/adapter';

/**
 * Mutation routes for tasks: PATCH/POST/DELETE plus a dedicated
 * dependency-replace endpoint. Each handler returns the updated chart
 * shape so the demo can `setBundle()` directly without a re-fetch
 * if it wants.
 */
export function tasksRoute(db: DB): Hono {
    const r = new Hono();

    /** Helper: parse JSON body or null on parse failure. */
    const parseBody = async (c: Context): Promise<unknown> => {
        try {
            return await c.req.json();
        } catch {
            return null;
        }
    };

    /** Helper: map adapter error → JSON response. */
    const errToJson = (c: Context, err: unknown) => {
        if (err instanceof PatchValidationError) {
            return c.json({ error: err.message }, 400);
        }
        if (err instanceof TaskNotFoundError) {
            return c.json({ error: err.message }, 404);
        }
        if (err instanceof DuplicateTaskError) {
            return c.json({ error: err.message }, 409);
        }
        throw err;
    };

    r.patch('/tasks/:id', async (c) => {
        const id = c.req.param('id');
        const body = await parseBody(c);
        if (body === null) return c.json({ error: 'invalid JSON body' }, 400);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return c.json({ error: 'body must be an object' }, 400);
        }
        try {
            return c.json(patchTask(db, id, body as Record<string, unknown>));
        } catch (err) {
            return errToJson(c, err);
        }
    });

    r.post('/tasks', async (c) => {
        const body = await parseBody(c);
        if (body === null) return c.json({ error: 'invalid JSON body' }, 400);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return c.json({ error: 'body must be an object' }, 400);
        }
        try {
            const created = createTask(db, body as CreateTaskInput);
            return c.json(created, 201);
        } catch (err) {
            return errToJson(c, err);
        }
    });

    r.delete('/tasks/:id', (c) => {
        try {
            deleteTask(db, c.req.param('id'));
            return c.json({ ok: true });
        } catch (err) {
            return errToJson(c, err);
        }
    });

    /**
     * Replace ALL incoming dependencies for the task with the supplied
     * array. Sends the full list, server reconciles. Form-friendly.
     */
    r.put('/tasks/:id/dependencies', async (c) => {
        const id = c.req.param('id');
        const body = await parseBody(c);
        if (!Array.isArray(body)) {
            return c.json(
                { error: 'body must be an array of dependency objects' },
                400,
            );
        }
        try {
            return c.json(
                replaceDependencies(
                    db,
                    id,
                    body as Array<{
                        id: string;
                        type?: string;
                        lag?: number;
                        max?: number | null;
                    }>,
                ),
            );
        } catch (err) {
            return errToJson(c, err);
        }
    });

    return r;
}

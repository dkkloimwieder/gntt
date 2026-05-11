import { Hono } from 'hono';
import type { DB } from '../db/client';
import {
    PatchValidationError,
    TaskNotFoundError,
    patchTask,
} from '../db/adapter';

/**
 * Mutation routes for tasks. v1 only wires PATCH (the demo's drag /
 * progress writes target it). POST/DELETE are stubbed for parity.
 */
export function tasksRoute(db: DB): Hono {
    const r = new Hono();

    r.patch('/tasks/:id', async (c) => {
        const id = c.req.param('id');
        let body: unknown;
        try {
            body = await c.req.json();
        } catch {
            return c.json({ error: 'invalid JSON body' }, 400);
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return c.json({ error: 'body must be an object' }, 400);
        }
        try {
            const updated = patchTask(db, id, body as Record<string, unknown>);
            return c.json(updated);
        } catch (err) {
            if (err instanceof PatchValidationError) {
                return c.json({ error: err.message }, 400);
            }
            if (err instanceof TaskNotFoundError) {
                return c.json({ error: err.message }, 404);
            }
            throw err;
        }
    });

    return r;
}

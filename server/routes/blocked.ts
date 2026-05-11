import { Hono, type Context } from 'hono';
import type { DB } from '../db/client';
import {
    BlockedNotFoundError,
    PatchValidationError,
    createBlocked,
    deleteBlocked,
    type CreateBlockedInput,
} from '../db/adapter';

export function blockedRoute(db: DB): Hono {
    const r = new Hono();

    const errToJson = (c: Context, err: unknown) => {
        if (err instanceof PatchValidationError)
            return c.json({ error: err.message }, 400);
        if (err instanceof BlockedNotFoundError)
            return c.json({ error: err.message }, 404);
        throw err;
    };

    r.post('/blocked', async (c) => {
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
            return c.json(createBlocked(db, body as CreateBlockedInput), 201);
        } catch (err) {
            return errToJson(c, err);
        }
    });

    r.delete('/blocked/:id', (c) => {
        const id = Number(c.req.param('id'));
        if (!Number.isFinite(id)) {
            return c.json({ error: 'id must be a number' }, 400);
        }
        try {
            deleteBlocked(db, id);
            return c.json({ ok: true });
        } catch (err) {
            return errToJson(c, err);
        }
    });

    return r;
}

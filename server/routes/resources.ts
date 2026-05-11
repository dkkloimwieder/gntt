import { Hono, type Context } from 'hono';
import type { DB } from '../db/client';
import {
    DuplicateResourceError,
    PatchValidationError,
    ResourceNotFoundError,
    createResource,
    deleteResource,
    type CreateResourceInput,
} from '../db/adapter';

export function resourcesRoute(db: DB): Hono {
    const r = new Hono();

    const errToJson = (c: Context, err: unknown) => {
        if (err instanceof PatchValidationError)
            return c.json({ error: err.message }, 400);
        if (err instanceof DuplicateResourceError)
            return c.json({ error: err.message }, 409);
        if (err instanceof ResourceNotFoundError)
            return c.json({ error: err.message }, 404);
        throw err;
    };

    r.post('/resources', async (c) => {
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
            return c.json(createResource(db, body as CreateResourceInput), 201);
        } catch (err) {
            return errToJson(c, err);
        }
    });

    r.delete('/resources/:id', (c) => {
        try {
            deleteResource(db, c.req.param('id'));
            return c.json({ ok: true });
        } catch (err) {
            return errToJson(c, err);
        }
    });

    return r;
}

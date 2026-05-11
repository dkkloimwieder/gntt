import { Hono } from 'hono';
import type { DB } from '../db/client';
import { loadBootstrap } from '../db/adapter';

/**
 * GET /api/bootstrap → entire chart-ready bundle (tasks, resources,
 * blockedTime). The demo calls this once on mount.
 */
export function bootstrapRoute(db: DB): Hono {
    const r = new Hono();
    r.get('/bootstrap', (c) => c.json(loadBootstrap(db)));
    return r;
}

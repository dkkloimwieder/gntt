/**
 * Hono app entry — exposes the demo backend on port 3001.
 *
 * Vite (running on :5173) proxies /api/* here so the browser sees
 * same-origin requests. Run via `pnpm dev:server` (alongside `pnpm dev`)
 * or `pnpm dev:all` to start both.
 */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { openDb } from './db/client';
import { bootstrapRoute } from './routes/bootstrap';
import { tasksRoute } from './routes/tasks';

const PORT = Number(process.env.PORT ?? 3001);
const db = openDb();

const app = new Hono();
app.route('/api', bootstrapRoute(db));
app.route('/api', tasksRoute(db));

// Tiny health probe for `curl` smoke checks.
app.get('/healthz', (c) => c.text('ok'));

serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`✓ Hono listening on http://localhost:${info.port}`);
});

export { app };

import { configDefaults, defineConfig } from 'vitest/config';
import solidPlugin from 'vite-plugin-solid';

// Vitest config for the test suite.
//
// The SolidJS plugin stays at the root so both projects inherit it
// (`extends: true`) and solid-js resolves to its client/dev build — that is
// what makes createEffect / createRoot reactive in tests. The plugin owns
// `resolve.conditions` and we deliberately do NOT hand-write them here.
//
// How that resolution actually works (verified against the installed
// vite-plugin-solid 2.11.12, not assumed):
//   - The plugin prepends `['solid', 'development', 'browser']` to whatever
//     Vite's per-environment defaults produced, keyed only on
//     `mode === 'test'` (dist/esm/index.mjs:152). It never consults
//     `test.environment` for this; the single place it reads that field is
//     :80-82, where it defaults an unset one to jsdom.
//   - solid-js publishes no `solid` export key, so the branch is decided by
//     `browser` vs `node` in its exports map — and `browser` is listed first,
//     so with this plugin installed even the node project loads `dist/dev.js`
//     (checked by running a `createEffect` under `--project server`: it fires,
//     and its arity is the client build's).
//   - The server-build hazard is therefore NOT "the plugin reacts to
//     `environment: 'node'`". It is Vitest's per-environment condition
//     defaults selecting solid-js's `node` key (`dist/server.js`, whose
//     `createEffect(fn, value) {}` is an inert stub), which is what would
//     happen if the plugin were dropped or run with `ssr: true`.
// We still give each project its own environment explicitly, and set none at
// the root, so the posture is stated rather than inherited.
//
// Two projects:
//   client — jsdom, for component/store/pure-function suites
//   server — node, for suites that need better-sqlite3 / drizzle / Hono
//
// Both include globs are ANCHORED at the repo root on purpose. Without an
// explicit `include`, Vitest's default `**/*.{test,spec}.*` also sweeps any
// git worktree parked under `.claude/`, running every suite once per
// worktree. `tests/**` and `tests/server/**` can only match this checkout —
// there is no leading `**/`, so the anchor holds. The client project matches
// nested directories too (`tests/components/bar.test.tsx`), because a
// single-segment `tests/*.test.*` would leave such a file collected by
// NEITHER project: silently never run.
export default defineConfig({
    plugins: [solidPlugin()],
    test: {
        globals: false,
        projects: [
            {
                extends: true,
                test: {
                    name: 'client',
                    environment: 'jsdom',
                    include: ['tests/**/*.test.{ts,tsx}'],
                    exclude: [...configDefaults.exclude, 'tests/server/**'],
                },
            },
            {
                extends: true,
                test: {
                    name: 'server',
                    environment: 'node',
                    include: ['tests/server/**/*.test.ts'],
                },
            },
        ],
    },
});

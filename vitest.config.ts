import { configDefaults, defineConfig } from 'vitest/config';
import solid from '@solidjs/vite-plugin';

// Vitest config for the test suite.
//
// The SolidJS plugin stays at the root so both projects inherit it
// (`extends: true`) and the `client` project resolves solid-js to its
// client/dev build — that is what makes createEffect / createRoot reactive in
// tests. The plugin owns `resolve.conditions` and we deliberately do NOT
// hand-write them here.
//
// How that resolution actually works (verified against the installed
// @solidjs/vite-plugin 3.0.0-next.39, not assumed):
//   - The plugin sets a per-project posture from `test.environment`:
//     `environment: 'node'` (or 'edge-runtime') selects the SERVER posture
//     (dist/esm/index.mjs:3621); every DOM environment keeps the CLIENT
//     posture, and an unset one is defaulted to jsdom (:3646-3647).
//   - Conditions are assembled per environment (:3751-3758):
//     `['solid', 'development'?, 'browser'?, ...vite defaults]`, where
//     `'browser'` is injected only when NOT in server posture; an unset
//     `resolve.conditions` falls back to `defaultServerConditions` (:3748).
//   - solid-js publishes no `solid` export key, so the branch is decided by
//     `browser` vs `node`. The client project therefore resolves
//     `browser.development.import` -> dist/dev.js (live subscription graph);
//     the server project resolves `node.import` -> dist/server.js, whose
//     `createEffect` is an inert stub, and the plugin inlines solid-js there
//     (:3649-3663) so the shared worker pool cannot leak the client build in.
//   - Measured, not inferred: the same `createEffect` + `flush` + setter +
//     `flush` probe reports `ran: 2, DEV: object, arity: 0` under
//     `--project client` and `ran: 0, DEV: undefined, arity: 3` under
//     `--project server`.
//   - Consequence: anything under `tests/server/**` gets the server build BY
//     DESIGN, and a reactive assertion placed there passes vacuously because
//     effects never run. Reactive tests do not belong in that project; today
//     it holds only DB/HTTP suites (adapter, crud, routes, schema), which is
//     the correct use of it.
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
    plugins: [solid()],
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

# DB-backed Demo

`examples/db.html` is the only demo that fetches its data from a backend
instead of inline fixtures. The backend is a small Node + SQLite + Drizzle
service exposed over a Hono REST API. The chart library itself is
storage-agnostic — none of the server code ships in the npm bundle.

## Architecture

```
  Browser ──fetch /api/*──► Vite :5173 ──proxy──► Hono :3001 ──► SQLite (data/gantt.db)
   (Solid)                                          │
                                                    └── Drizzle ORM
```

Two dev processes:
- **Vite** on `:5173` serves the demo bundle. `vite.config.ts` proxies
  `/api/*` to `:3001` so the browser sees same-origin requests (no CORS).
- **Hono** on `:3001` is the API server. One shared `better-sqlite3`
  connection, mounted under `/api`.

Run both at once with `pnpm dev:all`, or each in its own terminal
(`pnpm dev` + `pnpm dev:server`).

## Repository layout

```
server/
├── index.ts              # Hono entry, mounts routes, listens on :3001
├── db/
│   ├── schema.ts         # Drizzle table definitions
│   ├── client.ts         # better-sqlite3 → drizzle() wrapper
│   ├── adapter.ts        # Row ↔ GanttTask shape translation; CRUD helpers
│   ├── migrate.ts        # Applies migrations from server/migrations/
│   └── seed.ts           # Wipes + reloads tables from calendar.json
├── routes/
│   ├── bootstrap.ts      # GET  /api/bootstrap
│   ├── tasks.ts          # PATCH/POST/DELETE/PUT (deps) on tasks
│   ├── resources.ts      # POST/DELETE on resources
│   └── blocked.ts        # POST/DELETE on blocked time
└── migrations/           # drizzle-kit output (committed)

data/gantt.db             # SQLite file (gitignored; recreated by db:setup)

src/demo/
├── DbDemo.tsx            # Demo: chart + side panel + drag-PATCH
└── db/                   # Demo-only API client, modal, managers, forms
```

The **adapter** is the single seam: routes and tests use it; the demo
never imports anything from `server/`.

## Schema

Four tables. Dates are stored as ISO strings (`YYYY-MM-DD HH:MM`) to
match the chart's `GanttTask` contract — no Date round-tripping at the
API boundary.

| Table | Key columns | Notes |
|---|---|---|
| `resources` | `id`, `name`, `group_name?`, `sort_order` | Group used for collapsible swimlanes |
| `tasks` | `id`, `name`, `start`, `end`, `progress`, `resource_id?`, `parent_id?`, `type?`, `color?`, `color_progress?`, `baseline_start?`, `baseline_end?`, `constraints?`, `updated_at` | `constraints` is a JSON blob — flexible for the frontend's `TaskConstraints` shape |
| `dependencies` | autoinc `id`, `from_task_id`, `to_task_id`, `type` (FS/SS/FF/SF), `lag` (hours), `max_gap?` (hours; null = elastic) | FK cascade on task delete |
| `blocked_time` | autoinc `id`, `resource_id`, `start`, `end`, `reason?` | Flat metadata — **not** consulted by the constraint engine |

Indexes: `tasks.resource_id`, `tasks.parent_id`, `dependencies.from_task_id`,
`dependencies.to_task_id`, `blocked_time.resource_id`.

`blocked_time` exists so a future "resource unavailability" UI has a
home, but the chart treats every bar as absolute calendar time. See
[the relevant bd memory](#related) for context.

## REST API

All routes return JSON; errors are `{ error: string }` with an
appropriate status. The adapter raises typed errors (`PatchValidationError`,
`TaskNotFoundError`, `DuplicateTaskError`, `DuplicateResourceError`,
`ResourceNotFoundError`, `BlockedNotFoundError`) that the route layer
maps to HTTP codes.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/bootstrap` | — | `{ tasks, resources, blockedTime }` (chart-ready shape) |
| PATCH | `/api/tasks/:id` | `{ name?, start?, end?, progress?, resource?, color?, colorProgress?, baselineStart?, baselineEnd?, constraints? }` | Updated task |
| POST | `/api/tasks` | `GanttTaskInput` (optionally with inline `dependencies`) | Created task, 201 |
| DELETE | `/api/tasks/:id` | — | `{ ok: true }` |
| PUT | `/api/tasks/:id/dependencies` | `Array<{ id, type?, lag?, max? }>` — `id` is the predecessor task id; `max` is the max gap in hours (null/omitted = elastic) | Replaces the task's predecessor list (dedupes on `(id, type)`, rejects self-deps and unknown predecessors) |
| POST | `/api/resources` | `{ id, name, group?, order? }` | Created resource, 201 |
| DELETE | `/api/resources/:id` | — | `{ ok: true }` |
| POST | `/api/blocked` | `{ resource, start, end, reason? }` — `resource` is the resource id | Created slot |
| DELETE | `/api/blocked/:id` | — | `{ ok: true }` |
| GET | `/healthz` | — | `"ok"` (plain text, no `/api` prefix) |

`PATCH /api/tasks/:id` allowlists keys — unknown keys return 400, so
clients can't accidentally write to columns the demo doesn't intend to
expose. `progress` is range-checked to 0–100.

## Scripts

```bash
# One-time setup (creates data/gantt.db, applies migrations, loads seed)
pnpm db:setup

# Run both processes
pnpm dev:all

# Or in two terminals
pnpm dev          # Vite on :5173
pnpm dev:server   # Hono on :3001

# Regenerate migration after schema.ts changes
pnpm db:generate

# Reapply migrations / reseed individually
pnpm db:migrate
pnpm db:seed
```

The seed reads `src/data/generated/calendar.json` (the same fixture
`pnpm generate:calendar` produces). Resources are sorted alphabetically
before `sort_order` is assigned, so swimlane order is deterministic
across reseeds.

## Demo behaviour

`examples/db.html` mounts `DbDemo.tsx`. On load it `GET`s
`/api/bootstrap`; the side panel acts as a single source of actions
(add / edit / delete tasks, manage resources, manage blocked slots,
reload).

Drag mutations are the interesting bit — the chart only fires
`onDateChange` for the bar the user grabbed, but constraint-driven
batch-moves can shift dependents too. Naïvely re-fetching after each
drag introduces a visible snap-back due to precision rounding in the
chart's date math, so the demo instead:

1. Snapshots every bar's `_bar.x` and `_bar.width` after each bundle load.
2. On `onDateChange`, walks the chart's task store and computes per-task
   pixel deltas (`Δx`, `Δwidth`) against the snapshot.
3. Translates pixel deltas to ms via `unit × step / columnWidth` — exact
   arithmetic, bypassing the chart's `xToDate` which floors fractional
   days.
4. PATCHes each task whose bar drifted, in parallel.
5. Updates the snapshot in place; bumps a `dragVersion` signal so the
   edit panel re-derives from `dbState` (no full re-fetch, no flash).

Move vs. resize is disambiguated by both deltas:

| Gesture | Δx | Δwidth | Persisted change |
|---|---|---|---|
| Move | ≠ 0 | ≈ 0 | start += Δx, end += Δx |
| Resize end | ≈ 0 | ≠ 0 | start unchanged, end += Δwidth |
| Resize start | ≠ 0 | ≈ −Δx | start += Δx, end unchanged |

The general form is `startΔ = Δx`, `endΔ = Δx + Δwidth`.

Form-driven mutations (Save in the panel, Add modal, Delete) use a
normal re-fetch — the user has an explicit save-and-sync mental model
there, so a brief settle is acceptable.

## Tests

Hermetic — every test creates a fresh `Database(':memory:')`, applies
migrations via `drizzle-orm/better-sqlite3/migrator`, and exercises
the route handlers via `app.fetch(new Request(...))`. No real file I/O.

```
tests/server/
├── schema.test.ts     # Migrations apply; CRUD round-trip per table; FK cascades
├── adapter.test.ts    # loadBootstrap shape; constraints JSON parse; allowlist
├── routes.test.ts     # Hono fetch — bootstrap 200; PATCH success/reject
└── crud.test.ts       # POST/DELETE/PUT-deps end-to-end
```

## Out of scope

- Auth / multi-user (single-user demo).
- Optimistic UI with revert-on-error (Solid's reactive store updates
  locally before fetch resolves; failure surface is a status chip).
- Postgres / non-SQLite drivers — Drizzle's portability is the point;
  the swap is a config change later.
- WebSocket live updates.
- Working calendars / per-resource availability scheduling. See
  [related context](#related).

## Related

- The bd memory `bars-represent-absolute-calendar-time-the-chart-does`
  documents why working-calendar scheduling is explicitly out of scope.
- [`docs/DEMOS.md`](./DEMOS.md) — the demo index, including `db.html`.
- [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) — library architecture
  (the demo + server are layered on top of, not into, that surface).

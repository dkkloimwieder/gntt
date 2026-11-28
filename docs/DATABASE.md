# Database demo

The [database demo](../examples/db.html) gets chart data from a Hono API.
The API uses Drizzle ORM to read and write SQLite. The published chart
library accepts task and resource data from the caller.

## Start the demo

Run `pnpm db:setup` the first time. It creates `data/gantt.db`, applies
the committed migrations, and loads the calendar fixture. The SQLite
file is ignored by Git.

Run `pnpm dev:all` and open
[the database demo](http://localhost:5173/examples/db.html). Vite serves
the demo on port 5173 and forwards `/api` requests to Hono on port 3001.
You can also use `pnpm dev` and `pnpm dev:server` in separate terminals.

## Manage the database

| Command            | Behavior                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| `pnpm db:generate` | Writes a migration after changes to `server/db/schema.ts`. Commit the SQL and its metadata together. |
| `pnpm db:migrate`  | Applies pending migrations. You can run it again after it succeeds.                                  |
| `pnpm db:seed`     | Deletes existing demo records and loads `src/data/generated/calendar.json`.                          |
| `pnpm db:setup`    | Runs both the migration and seed commands.                                                           |

Keep a copy of local changes before you reseed. You can generate the
calendar fixture with `pnpm generate:calendar`. The seed assigns
resource ordering metadata alphabetically.

The migration and seed scripts accept `GANTT_DB_PATH` for a separate
SQLite file. The demo API opens `./data/gantt.db` by default.

## Schema

The demo sends and stores dates as text in `YYYY-MM-DD HH:MM` format.

| Table          | Key columns                                                                                 | Notes                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `resources`    | `id`, `name`, `group_name`, `sort_order`                                                    | Optional group name and order metadata.                                                |
| `tasks`        | `id`, `name`, `start`, `end`, `progress`, `resource_id`, `parent_id`, `type`, `constraints` | `constraints` stores the chart constraint fields as JSON.                              |
| `dependencies` | `id`, `from_task_id`, `to_task_id`, `type`, `lag`, `max_gap`                                | Lag and maximum gap offsets are in hours. Deleting either task deletes the dependency. |
| `blocked_time` | `id`, `resource_id`, `start`, `end`, `reason`                                               | Availability metadata for the demo.                                                    |

Deleting a resource clears its ID from tasks and deletes its blocked
time records. The chart schedules tasks in calendar time without using
blocked time as a constraint.

## REST API

API routes return JSON. Handled validation, missing-record, and duplicate
errors use `{ error: string }` with status 400, 404, or 409. The health route
returns plain text.

| Method | Path                          | Body                                                                                                                | Returns                                                                 |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| GET    | `/api/bootstrap`              | None                                                                                                                | `{ tasks, resources, blockedTime }`                                     |
| POST   | `/api/tasks`                  | `{ id, name, start, end, progress?, resource?, color?, colorProgress?, type?, constraints?, dependencies? }`        | Created task, 201. Invalid inline dependencies reject the whole create. |
| PATCH  | `/api/tasks/:id`              | `{ name?, start?, end?, progress?, resource?, color?, colorProgress?, baselineStart?, baselineEnd?, constraints? }` | Updated task. Unknown fields and progress outside 0–100 return 400.     |
| DELETE | `/api/tasks/:id`              | None                                                                                                                | `{ ok: true }`                                                          |
| PUT    | `/api/tasks/:id/dependencies` | `Array<{ id, type?, lag?, max? }>`                                                                                  | Updated task. The array replaces its entire predecessor list.           |
| POST   | `/api/resources`              | `{ id, name, group?, order? }`                                                                                      | Created resource, 201                                                   |
| DELETE | `/api/resources/:id`          | None                                                                                                                | `{ ok: true }`                                                          |
| POST   | `/api/blocked`                | `{ resource, start, end, reason? }`                                                                                 | Created slot, 201                                                       |
| DELETE | `/api/blocked/:id`            | None                                                                                                                | `{ ok: true }`                                                          |
| GET    | `/healthz`                    | None                                                                                                                | `ok`                                                                    |

In a dependency, `id` names the predecessor. Omit `max` or pass `null` to
leave the maximum gap unbounded. The API skips duplicate predecessor and
type pairs. It rejects self-dependencies and missing predecessors.

## Save chart edits

On load, the demo fetches `/api/bootstrap`. Forms reload this data after a successful save.

For a drag or keyboard edit, the demo saves the dates from `onDateChange`. If the edit moves dependent tasks, the demo converts their final bar edges to dates with the chart calendar.

The demo stores local timestamps as `YYYY-MM-DD HH:MM`. This format stores the same text for both occurrences of a minute when the clock moves back.

The demo saves gestures in order. Within each gesture, it sends a PATCH request for each task whose dates changed. If one request fails, the demo reports the error and keeps the successful edits.

## Code and tests

| Path                                            | Purpose                                                                       |
| ----------------------------------------------- | ----------------------------------------------------------------------------- |
| [server/index.ts](../server/index.ts)           | Starts Hono and mounts the API routes.                                        |
| [server/db/adapter.ts](../server/db/adapter.ts) | Converts SQLite rows to the chart format and handles requests to change them. |
| [server/migrations](../server/migrations)       | Committed SQLite migration SQL and metadata.                                  |
| [src/demo/DbDemo.tsx](../src/demo/DbDemo.tsx)   | Connects the chart, edit forms, and API.                                      |
| [tests/dbDemo.test.tsx](../tests/dbDemo.test.tsx) | Exercises a keyboard resize and the dates sent for both affected tasks. |
| [tests/server](../tests/server)                 | Covers the schema, adapter, HTTP routes, and CRUD operations.                 |

Run `pnpm test --project server` to run the backend suite. The tests apply
the committed migrations to in-memory SQLite databases. HTTP tests send
requests directly to the Hono app.

The demo supports local edits by one user. Authentication, live updates,
and working calendars are outside its scope. See the
[demo index](./DEMOS.md) and [constraint guide](./CONSTRAINTS.md).

# Gantt

A Gantt chart library built with SolidJS 2.0.

## Install from this checkout

Build and pack the library in the repository directory. This creates `ganttss-1.0.3.tgz`.

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm pack
```

In the application directory, replace the example path with the path to that file.

```bash
pnpm add /path/to/gantt/ganttss-1.0.3.tgz solid-js@^2.0.4 @solidjs/web@^2.0.4
```

The chart uses the application's copies of `solid-js` and `@solidjs/web`.
Both are peer dependencies. Install the same Solid 2 release for each package.

**TypeScript.** The components are compiled from TSX against Solid 2.0's JSX
namespace, so your `tsconfig.json` needs:

```jsonc
{
    "compilerOptions": {
        "jsx": "preserve",
        "jsxImportSource": "@solidjs/web"
    }
}
```

For a Vite application, install the Solid compiler plugin and configure Vite to share both runtimes.

```bash
pnpm add -D vite@^8 @solidjs/vite-plugin@^3
```

```js
import { defineConfig } from 'vite';
import solid from '@solidjs/vite-plugin';

export default defineConfig({
    plugins: [solid()],
    resolve: { dedupe: ['solid-js', '@solidjs/web'] },
});
```

The package exports a browser ES module and TypeScript declarations. In applications with server rendering, import the chart from a client-only entry.
The package requires Node 22.12 or later. The repository's development tools have additional [Node requirements](#development).

## Usage

```tsx
import { Gantt, type GanttTask } from 'ganttss';

export function App() {
    const tasks: GanttTask[] = [
        { id: '1', name: 'Task 1', start: '2025-01-01', end: '2025-01-05', progress: 50 },
        { id: '2', name: 'Task 2', start: '2025-01-03', end: '2025-01-08', progress: 0,
          dependencies: [{ id: '1' }] },
    ];

    return <Gantt tasks={tasks} />;
}
```

## Configuration

Pass these fields in the `options` prop, for example `<Gantt tasks={tasks} options={{ viewMode: 'Week' }} />`.

| Option | Description | Default |
|--------|-------------|---------|
| `viewMode` | Timeline view from `Minute` through `Year` | `Day` |
| `barHeight` | Height of task bars (px) | `30` |
| `columnWidth` | Override the active view's column width (px) | `45` in Day view |
| `padding` | Padding around task bars (px) | `18` |
| `readonly` | Disable all editing | `false` |
| `readonlyDates` | Disable date editing | `false` |
| `readonlyProgress` | Disable progress editing | `false` |
| `scrollTo` | Initial scroll target, either `'start'` or `'today'` | No initial scroll |
| `criticalPath` | Highlight tasks on the critical path | `false` |

Dependencies constrain gestures and appear in SVG exports. The interactive chart currently displays bars and the grid without dependency arrows.

Per-task fields (on the data shape passed to `tasks`): `id`, `name`,
`start`, `end`, `progress`, `dependencies`, `color`, `colorProgress`,
`resource`, `baselineStart`, `baselineEnd`.

Adding `baselineStart` + `baselineEnd` to a task renders a thin dashed
ghost bar above the actual bar — useful for tracking schedule variance
between the original plan and the current state. Both fields must be
present together; a half-specified baseline is silently ignored. Style
the ghost via the `--g-baseline-color` and `--g-baseline-border` CSS
variables.

## Callbacks

| Prop | Signature | Fires when |
|------|-----------|------------|
| `onDateChange` | `(taskId, { start: Date, end: Date }, position?: { x: number, width: number }) => void` | Task is dragged or resized; `position` is the pixel rect the dates were derived from |
| `onProgressChange` | `(taskId, progress: number) => void` | Progress handle is dragged |
| `onResizeEnd` | `(taskId, geometry?: { x: number, width: number }) => void` | Resize gesture finishes; `geometry` is the post-resize pixel rect |
| `onTaskClick` | `(taskId, event: MouseEvent) => void` | A click, Enter, or Space activates a task bar |
| `onSelectionChange` | `(selectedIds: Set<string>) => void` | Selection is initialized or changes |
| `onReady` | `(api: GanttAPI) => void` | The mounted chart has measured its viewport |

Use `api.exportSvg()` for SVG text, `api.exportSvgBlob()` for a file, or `await api.exportPng()` for a PNG file.
Pass `{ range: 'visible' }` to export the current viewport.

Use the callback arguments for the result of a gesture. A store read in the handler can still return the previously committed value.
The date conversion can drop a fractional time unit, such as half a day in Day view. For sub-day persistence, the database demo uses the supplied pixel geometry and the active time scale. See [Database architecture](docs/DATABASE.md).

## Reactivity & timing

The chart runs on Solid 2.0, whose writes are **deferred**: a setter stages
its value and reads keep returning the previously committed one until the
microtask flush. Four consequences reach the public API.

**Config setters are void updaters.** Every `set*` on the config store has
the type `ConfigSetter<T> = (value: Exclude<T, Function> | ((prev: T) => T))
=> void`. It accepts a value or an updater and returns **nothing** — under
deferred writes there is no post-write value to hand back. Compose instead of
chaining:

```js
config.setColumnWidth((w) => w * 2); // ✅ updater composes against the staged value
const w = config.setColumnWidth(90); // ❌ always undefined
```

**Readers answer about committed state.** `taskStore.getTask`,
`getBarPosition`, `getAllTasks`, `taskCount` and `isTaskCollapsed`, plus
`resourceStore.isGroupCollapsed`, return what has been committed — not what
you just staged. Read them inside JSX, a memo, or an effect's compute and
they track normally. Read one immediately after a write in the same turn and
it answers with the pre-write value:

```js
import { flush } from 'solid-js';

taskStore.toggleTaskCollapse('t1');
taskStore.isTaskCollapsed('t1'); // ❌ still the PRE-toggle answer
flush();
taskStore.isTaskCollapsed('t1'); // ✅ committed
```

`flush()` is legal in event handlers, timers, promise continuations and test
bodies. It is a silent no-op inside an effect's apply phase and **throws**
inside `onSettled`. Prefer deriving what you need from the callback arguments
or from your own local value over reaching for it.

**Bulk collapse takes explicit ids.** `taskStore.collapseAllTasks(ids?)` and
`resourceStore.collapseAll(ids?)` derive their default target list from
committed state. If you wrote the task or resource list in the same turn,
pass the ids you just built — otherwise the read-back sees the pre-write list
and the wrong rows collapse.

**Column renderers must be pure.** `ColumnDef.render(task, resourceId)` is
called from inside a tracking scope on every re-render of that cell. Return
markup; do not write to a store, start a request, or create a reactive
primitive from it.

## Keyboard & accessibility

In the full task layer, a regular task bar has `role="button"` and
an `aria-label` describing the task identity, date range, and progress.
Read-only bars have `tabindex=-1`. Other regular task bars have `tabindex=0`.
The chart container exposes `role="region"` with
`aria-roledescription="gantt chart"` so screen readers announce it as a
single landmark.

Keyboard shortcuts on a focused bar:

| Key | Action |
|-----|--------|
| `Tab` / `Shift+Tab` | Move focus between bars |
| `←` / `→` | Move bar by one column (one unit of the current view mode) |
| `Shift+←` / `Shift+→` | Resize bar from the right edge by one column |
| `Enter` / `Space` | Activate the task. The built-in modal opens unless `disableTaskClickModal` is set. |

Arrow-key moves check the task's dependency and date bounds. Shift+arrow resizes the right edge and can push successors.
`readonly`, `readonlyDates`, and `constraints.locked: true` prevent keyboard date edits.

## Advanced usage — `<GanttProvider>`

The bare `<Gantt tasks={...} />` form is enough for most apps; the chart
creates its internal stores on its own. Wrap with `<GanttProvider>` only
when sibling components need to read or mutate the same state — e.g.
a custom toolbar, a side panel, or a test harness.

```tsx
import { GanttProvider, Gantt, useGanttStores, type GanttTask, type ResourceInput } from 'ganttss';

function Toolbar() {
    const stores = useGanttStores();
    return (
        <button onClick={() => { stores?.dateStore.changeViewMode('Week'); }}>
            Week view
        </button>
    );
}

export function App(props: { tasks: GanttTask[]; resources: ResourceInput[] }) {
    return (
        <GanttProvider options={{ viewMode: 'Day' }} resources={props.resources}>
            <Toolbar />
            <Gantt tasks={props.tasks} />
        </GanttProvider>
    );
}
```

`useGanttStores()` returns `undefined` outside a provider, so callers can
fall back gracefully — `useGanttStores() ?? myOwnStores` is the intended
shape. (Note that in Solid 2.0 a context created without a default *throws*
in `useContext`; this one is deliberately created with a `null` default so
that "no provider" stays a supported state.) It yields four stores:
`taskStore`, `ganttConfig`, `dateStore`, `resourceStore`.

The lower-level `createTaskStore()`, `createGanttConfigStore(options?)`,
`createGanttDateStore(options?)`, and `createResourceStore(resources?)`
remain exported for full manual wiring.

## Breaking changes

### SolidJS 2.0

This release runs on Solid 2.0 and will not run on Solid 1.x. What a
consumer has to change:

- Install `solid-js@^2.0.4` **and** `@solidjs/web@^2.0.4`; set
  `jsxImportSource: '@solidjs/web'`; build with `@solidjs/vite-plugin`.
- The package is ESM-only — the UMD output and its globals map are gone.
- Node `>=22.12.0`.
- Config-store setters return `void` instead of the written value
  (`ConfigSetter<T>`), and store readers answer about committed state. See
  [Reactivity & timing](#reactivity--timing).

No public prop, option, or task-data field name changed in this release.

### camelCase field names

The following options and task fields changed to camelCase.

| Renamed from | To | Issue |
|---|---|---|
| `view_mode` | `viewMode` | gantt-i8b |
| `bar_height` | `barHeight` | gantt-i8b |
| `column_width` | `columnWidth` | gantt-i8b |
| `readonly_dates` | `readonlyDates` | gantt-i8b |
| `readonly_progress` | `readonlyProgress` | gantt-i8b |
| `scroll_to` | `scrollTo` | gantt-cwe |
| `arrow_color` | `arrowColor` | gantt-cwe |
| `color_progress` | `colorProgress` (on tasks) | gantt-cwe |

The `onDateChange` callback signature also changed: it now emits
`{ start: Date, end: Date }` instead of `{ x: number, width: number }`
in pixels. Consumers no longer need to convert pixel coordinates back
to dates using internal helpers.

If you're upgrading from a pre-camelCase release, update consumer
code accordingly. There is no compatibility shim.

## Development

The test suite uses jsdom. Use Node 22.22.2 or later on the 22.x line,
24.15.0 or later on the 24.x line, or Node 26 or later.
Use the pnpm version in `package.json`.

```bash
pnpm i
pnpm dev
# Open http://localhost:5173/examples/
```

See `docs/ARCHITECTURE.md` for implementation details.

`pnpm test` runs the chart suites in jsdom and the database suites in Node.
`pnpm typecheck`, `pnpm lint`, and `pnpm prettier-check` run TypeScript, Oxlint, and Prettier.

## DB-backed demo

`examples/db.html` swaps the inline fixtures for a real backend — Node +
SQLite + Drizzle + Hono, with the chart talking to a REST API. The
library itself stays storage-agnostic; nothing in `server/` ships in
the npm bundle.

```bash
pnpm db:setup    # creates data/gantt.db, applies migrations, loads seed
pnpm dev:all     # runs Vite (:5173) + Hono (:3001) together
# Open http://localhost:5173/examples/db.html
```

The two processes can also be run separately as `pnpm dev` and
`pnpm dev:server`. See [`docs/DATABASE.md`](docs/DATABASE.md) for the
schema, REST surface, and the drag-PATCH algorithm used to persist
moves and resizes without a re-fetch flash.

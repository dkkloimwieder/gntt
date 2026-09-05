# Gantt

A Gantt chart library built with SolidJS 2.0.

## Install

```bash
pnpm add ganttss solid-js@2.0.0-rc.6 @solidjs/web@2.0.0-rc.6
```

`solid-js` and `@solidjs/web` are left external in the published bundle, so
the chart runs on **your** app's runtime instances. Both must be Solid 2.0 —
this release does not run on Solid 1.x.

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

**Vite.** Compile JSX with Solid 2.0's plugin, and dedupe both runtimes so a
nested copy can never create a second reactive graph — two instances mean
signals written through one are invisible to effects created by the other:

```js
import { defineConfig } from 'vite';
import solid from '@solidjs/vite-plugin';

export default defineConfig({
    plugins: [solid()],
    resolve: { dedupe: ['solid-js', '@solidjs/web'] },
});
```

**Packaging.** The package is **ESM-only** (no UMD, no CommonJS build) and
requires Node `^20.19 || >=22.12`. Neither Solid 2.0 runtime ships a global
build, so a UMD bundle could never resolve its externals in a browser.

## Usage

```jsx
import { Gantt } from 'ganttss';

function App() {
    const tasks = [
        { id: '1', name: 'Task 1', start: '2025-01-01', end: '2025-01-05', progress: 50 },
        { id: '2', name: 'Task 2', start: '2025-01-03', end: '2025-01-08', progress: 0,
          dependencies: [{ id: '1' }] },
    ];

    return <Gantt tasks={tasks} />;
}
```

## Configuration

| Option | Description | Default |
|--------|-------------|---------|
| `viewMode` | Timeline view (`Day`, `Week`, `Month`, `Year`) | `Day` |
| `barHeight` | Height of task bars (px) | `30` |
| `columnWidth` | Width of timeline columns (px) | `45` |
| `padding` | Padding around task bars (px) | `18` |
| `readonly` | Disable all editing | `false` |
| `readonlyDates` | Disable date editing | `false` |
| `readonlyProgress` | Disable progress editing | `false` |
| `scrollTo` | Initial scroll target (`'start'`, `'today'`, or ISO date) | — |
| `arrowColor` | Dependency arrow color | `'#a3a3ff'` |

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
| `onDateChange` | `(taskId, { start: Date, end: Date }) => void` | Task is dragged or resized |
| `onProgressChange` | `(taskId, progress: number) => void` | Progress handle is dragged |
| `onResizeEnd` | `(taskId) => void` | Resize gesture finishes |
| `onTaskClick` | `(taskId, event: MouseEvent) => void` | Bar is clicked |

Each callback hands you what the gesture produced. Do **not** call back into
a store from a handler to discover what just happened — reads answer about
committed state, so inside the handler they still describe the world *before*
the gesture. See the timing note below.

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

Each task bar is a focusable button (`role="button"`, `tabindex=0`) with
an `aria-label` describing the task identity, date range, and progress.
The chart container exposes `role="region"` with
`aria-roledescription="gantt chart"` so screen readers announce it as a
single landmark.

Keyboard shortcuts on a focused bar:

| Key | Action |
|-----|--------|
| `Tab` / `Shift+Tab` | Move focus between bars |
| `←` / `→` | Move bar by one column (one unit of the current view mode) |
| `Shift+←` / `Shift+→` | Resize bar from the right edge by one column |
| `Enter` / `Space` | Open the task modal |

Movement honours the same dependency constraints as drag, so keyboard
edits cannot violate FS/SS/FF/SF relationships. `readonly`,
`readonlyDates`, and the per-task `locked` flag suppress keyboard edits
in the same places they suppress drag.

## Advanced usage — `<GanttProvider>`

The bare `<Gantt tasks={...} />` form is enough for most apps; the chart
creates its internal stores on its own. Wrap with `<GanttProvider>` only
when sibling components need to read or mutate the same state — e.g.
a custom toolbar, a side panel, or a test harness.

```jsx
import { GanttProvider, Gantt, useGanttStores } from 'ganttss';

function Toolbar() {
    const stores = useGanttStores();
    return (
        <button onClick={() => stores.dateStore.changeViewMode('Week')}>
            Week view
        </button>
    );
}

function App() {
    return (
        <GanttProvider options={{ viewMode: 'Day' }} resources={resources}>
            <Toolbar />
            <Gantt tasks={tasks} />
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

- Install `solid-js@2.0.0-rc.6` **and** `@solidjs/web@2.0.0-rc.6`; set
  `jsxImportSource: '@solidjs/web'`; build with `@solidjs/vite-plugin`.
- The package is ESM-only — the UMD output and its globals map are gone.
- Node `^20.19 || >=22.12`.
- Config-store setters return `void` instead of the written value
  (`ConfigSetter<T>`), and store readers answer about committed state. See
  [Reactivity & timing](#reactivity--timing).

No public prop, option, or task-data field name changed in this release.

### camelCase field names

All public option, prop, and task-data field names use **camelCase**.
Previous snake_case forms were removed in two passes:

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

```bash
pnpm i
pnpm dev
# Open http://localhost:5173/examples/
```

See `docs/ARCHITECTURE.md` for implementation details.

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

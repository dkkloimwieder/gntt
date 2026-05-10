# Gantt

A Gantt chart library built with SolidJS.

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
`resource`.

## Callbacks

| Prop | Signature | Fires when |
|------|-----------|------------|
| `onDateChange` | `(taskId, { start: Date, end: Date }) => void` | Task is dragged or resized |
| `onProgressChange` | `(taskId, progress: number) => void` | Progress handle is dragged |
| `onResizeEnd` | `(taskId) => void` | Resize gesture finishes |
| `onTaskClick` | `(taskId, event: MouseEvent) => void` | Bar is clicked |

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
fall back gracefully. The lower-level `createTaskStore`,
`createGanttConfigStore`, `createGanttDateStore`, and `createResourceStore`
remain exported for full manual wiring.

## Breaking changes

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

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

If you're upgrading from a pre-camelCase release, update consumer
code accordingly. There is no compatibility shim.

## Development

```bash
pnpm i
pnpm dev
# Open http://localhost:5173/examples/
```

See `docs/ARCHITECTURE.md` for implementation details.

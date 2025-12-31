# Gantt

A Gantt chart library built with SolidJS.

## Installation

```bash
npm install ganttss solid-js
```

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
| `view_mode` | Timeline view (`Day`, `Week`, `Month`, `Year`) | `Day` |
| `bar_height` | Height of task bars (px) | `30` |
| `column_width` | Width of timeline columns (px) | `45` |
| `padding` | Padding around task bars (px) | `18` |
| `readonly` | Disable all editing | `false` |
| `readonly_dates` | Disable date editing | `false` |
| `readonly_progress` | Disable progress editing | `false` |

## Development

```bash
pnpm i
pnpm dev
# Open http://localhost:5173/examples/
```

See `docs/ARCHITECTURE.md` for implementation details.

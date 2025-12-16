# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Frappe Gantt** is a Gantt chart library with two implementations:

- **SolidJS** (primary, in `src/`) - The active implementation using reactive stores and fine-grained reactivity
- **Vanilla JS** (legacy, in `vanilla/`) - The original implementation, archived for reference

The library provides drag & drop task management, dependency visualization, constraint enforcement (FS/SS/FF/SF), and theme support.

## Essential Commands

### Build & Development
- `pnpm run dev:solid` - Start SolidJS demo server at http://localhost:5173/examples/
- `pnpm run generate:calendar` - Generate test calendar data (see Performance Testing below)
- `pnpm build:solid` - Build SolidJS production bundle
- `pnpm dev` - Start vanilla JS dev server (legacy)
- `pnpm build` - Build vanilla JS bundle

### Code Quality
- `pnpm lint` - Lint JavaScript files
- `pnpm prettier` - Format code
- `pnpm prettier-check` - Check formatting without modifying

### Note on Testing
Only one test file exists (`tests/date_utils.test.js`) but no test runner is configured in package.json.

## Architecture

### Directory Structure

```
gantt/
├── src/                        # SolidJS (primary)
│   ├── components/             # UI components (Gantt, Bar, Arrow, Grid, etc.)
│   ├── stores/                 # Reactive stores (ganttStore, ganttConfigStore, ganttDateStore)
│   ├── utils/                  # Utilities (barCalculations, constraintResolver, etc.)
│   ├── hooks/                  # useDrag
│   ├── adapters/               # Data adapters
│   ├── entries/                # Entry points for each demo
│   ├── scripts/                # CLI tools (generateCalendar.js)
│   ├── data/                   # Generated test data
│   └── styles/                 # CSS
├── examples/                   # SolidJS demo HTML files
│   ├── index.html              # Demo hub
│   ├── gantt.html              # Main demo
│   ├── project.html            # Subtask demo (100 tasks with subtasks)
│   ├── resource-groups.html    # Collapsible resource groups demo
│   ├── perf.html               # Performance test (200+ tasks)
│   ├── arrow.html, bar.html    # Component demos
│   └── constraint.html, showcase.html
├── vanilla/                    # Legacy vanilla JS (archived)
│   ├── src/                    # Original JS source
│   └── examples/               # Original demo
├── docs/
│   ├── ARCHITECTURE.md         # Detailed SolidJS architecture
│   └── SUBTASKS.md             # Subtask feature documentation
└── [config files]
```

### SolidJS Architecture

The SolidJS implementation uses reactive stores for state management:

**Stores:**
- `taskStore.js` - Task data and operations
- `ganttConfigStore.js` - Configuration (view mode, dimensions, features)
- `ganttDateStore.js` - Timeline calculations and date utilities
- `resourceStore.js` - Resource groups with collapse/expand state

**Components:**
- `Gantt.jsx` - Main container component
- `Bar.jsx` - Task bars with drag/resize/progress handles
- `Arrow.jsx` - Dependency visualization
- `Grid.jsx` - Background grid and time scale
- `ResourceColumn.jsx` - Resource names column
- `ExpandedTaskContainer.jsx` - Parent task with subtasks (see [SUBTASKS.md](docs/SUBTASKS.md))
- `SubtaskBar.jsx` - Individual subtask bars

**Utilities:**
- `barCalculations.js` - Position/size calculations from dates
- `constraintResolver.js` - Dependency constraint enforcement (FS/SS/FF/SF)
- `subtaskGenerator.js` - Generates test data with subtasks
- `rowLayoutCalculator.js` - Variable row heights for expanded subtasks
- `createVirtualViewport.js` - Simple 2D viewport virtualization
- `resourceProcessor.js` - Resource normalization and group display logic
- `taskGenerator.js` - Test data generation

See `docs/ARCHITECTURE.md` for detailed documentation.

## Performance Testing

The SolidJS implementation includes a task generator for performance testing with realistic calendar data.

### Quick Start
```bash
pnpm run generate:calendar          # Generate 200 tasks
pnpm run dev:solid                   # Start dev server
# Open http://localhost:5173/examples/perf.html
```

### Task Generator

Located at `src/scripts/generateCalendar.js`, generates `src/data/calendar.json`.

**Features:**
- Cross-resource dependency chains (tasks in a group span different resources A-Z)
- No overlap per resource (concurrency = 1)
- Workday-aware scheduling (08:00-17:00, rolls over to next day)
- Mixed FS/SS dependencies with configurable lag
- Seeded random for reproducible results

**CLI Options:**
```bash
node src/scripts/generateCalendar.js --help
node src/scripts/generateCalendar.js --tasks=300 --seed=54321 --ss=30
```

| Option | Default | Description |
|--------|---------|-------------|
| `--tasks=N` | 200 | Total number of tasks |
| `--seed=N` | 12345 | Random seed for reproducibility |
| `--ss=N` | 20 | Percentage of SS (Start-to-Start) dependencies |
| `--minGroup=N` | 5 | Minimum tasks per dependency group |
| `--maxGroup=N` | 20 | Maximum tasks per dependency group |
| `--start=DATE` | 2025-01-01 | Start date (YYYY-MM-DD) |

**Generated Data Structure:**
```javascript
{
  id: "task-1",
  name: "G1-1",              // Group 1, Task 1
  start: "2025-01-01 08:00", // Workday-aware
  end: "2025-01-01 16:00",
  progress: 87,
  color: "#3b82f6",
  color_progress: "#3b82f6cc",
  dependencies: "task-0" | { id, type: "SS", lag: 2 },
  resource: "E"              // A-Z, no overlap on same resource
}
```

**Key Files:**
- `src/utils/taskGenerator.js` - Shared generation logic
- `src/scripts/generateCalendar.js` - CLI script
- `src/data/calendar.json` - Generated test data
- `src/components/GanttPerfDemo.jsx` - Performance test UI

## Development Workflow

1. Clone and run `pnpm i`
2. Run `pnpm run dev:solid` to start the development server
3. Open http://localhost:5173/examples/ to see the demo hub
4. Edit source files in `src/` - Vite automatically reloads

## Code Style

- ES6 modules with import/export
- 4-space indentation, single quotes
- ESLint + Prettier configured
- JSX for SolidJS components

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Frappe Gantt** is a lightweight, vanilla JavaScript library for creating interactive Gantt charts using SVG rendering. It's production-ready and used by ERPNext. The library provides drag & drop task management, dependency visualization, multiple view modes (Hour/Day/Week/Month/Year), and theme support.

## Essential Commands

### Build & Development
- `pnpm build` - Build production bundle (UMD + ES modules)
- `pnpm build-dev` - Build in watch mode for development
- `pnpm dev` - Start Vite development server with hot reload
- `pnpm run dev:solid` - Start SolidJS demo server (showcase, bar, arrow demos)
- `pnpm run generate:calendar` - Generate test calendar data (see Performance Testing below)
- Test changes: Open `index.html` in browser after building

### Code Quality
- `pnpm lint` - Lint JavaScript files
- `pnpm prettier` - Format code
- `pnpm prettier-check` - Check formatting without modifying

### Note on Testing
Only one test file exists (`tests/date_utils.test.js`) but no test runner is configured in package.json.

## Architecture

### Core Design
Class-based OOP architecture with imperative DOM manipulation (no framework). The codebase follows a clear separation of concerns:

**Main Orchestrator:**
- `src/index.js` (Gantt class) - Central coordinator that manages setup, rendering, view mode switching, and event handling. Creates and coordinates all subcomponents.

**Components:**
- `src/bar.js` (Bar class) - Individual task bars with drag & drop, resize handles, and progress updates
- `src/arrow.js` (Arrow class) - Dependency arrows with dynamic SVG path calculation
- `src/popup.js` (Popup class) - Task detail tooltips

**Utilities:**
- `src/date_utils.js` - Pure date manipulation functions (parse, format, add, diff) with locale support
- `src/svg_utils.js` - SVG DOM helpers (jQuery-like $ selector, createSVG, animateSVG)
- `src/defaults.js` - Configuration constants including DEFAULT_OPTIONS and view mode definitions

### Data Flow

**Initialization:**
```
new Gantt() → setup_wrapper() → setup_options() → setup_tasks() →
change_view_mode() → bind_events()
```

**Rendering:**
```
render() → clear() → setup_layers() → make_grid() → make_dates() →
make_grid_extras() → make_bars() → make_arrows() →
set_dimensions() → set_scroll_position()
```

### Key Architectural Patterns

1. **Imperative SVG Rendering** - Direct SVG element creation and manipulation, no virtual DOM
2. **Event-Driven Interactions** - Mouse events (mousedown/mousemove/mouseup) handle all drag operations
3. **Prototype Extension** - Adds helper methods to SVGElement.prototype (getX, getY, getWidth, etc.)
4. **Configuration Object Pattern** - Extensive options for customization via DEFAULT_OPTIONS
5. **Singleton Instances** - Each Gantt instance independently manages its own state

### Important Features

- **View Modes**: Time scales are fully configurable in `defaults.js` with column widths, date formats, and header rendering logic
- **Ignored Dates**: Complex logic for excluding weekends/holidays from task duration calculations
- **Infinite Padding**: Timeline automatically extends when scrolling to edges
- **Dependencies**: Tasks reference other tasks by ID; arrows update dynamically when bars move
- **Drag & Drop**: Complex state machine in Bar class handles dragging bars, resizing with handles, and updating progress

### Build System

- **Vite** bundles the library (see `vite.config.js`)
- Outputs: `frappe-gantt.umd.js` (UMD) and `frappe-gantt.es.js` (ES modules)
- CSS: PostCSS with nesting plugin compiles `src/styles/` to `frappe-gantt.css`
- Themes: `light.css` and `dark.css` use CSS variables

### Migration Context

**Important**: The codebase is migrating from vanilla JS to SolidJS. The SolidJS implementation is now feature-complete for core functionality:

- **Complete**: Main Gantt orchestrator, Bar, Arrow, Grid, Headers, Popup, Modal
- **Complete**: Task/Config/Date stores, constraint system (FS/SS/FF/SF dependencies)
- **Complete**: Drag, resize, progress editing with constraint enforcement
- **Pending**: Public API wrapper (`new Gantt()`), view mode switching, infinite scroll

See `SOLID_ARCHITECTURE.md` for detailed documentation. Run `pnpm run dev:solid` and open http://localhost:5173/gantt-demo.html for the main demo.

## Performance Testing

The SolidJS implementation includes a task generator for performance testing with realistic calendar data.

### Quick Start
```bash
pnpm run generate:calendar          # Generate 200 tasks
pnpm run dev:solid                   # Start dev server
# Open http://localhost:5173/gantt-perf.html
```

### Task Generator

Located at `src/solid/scripts/generateCalendar.js`, generates `src/solid/data/calendar.json`.

**Features:**
- Cross-resource dependency chains (tasks in a group span different resources A-Z)
- No overlap per resource (concurrency = 1)
- Workday-aware scheduling (08:00-17:00, rolls over to next day)
- Mixed FS/SS dependencies with configurable lag
- Seeded random for reproducible results

**CLI Options:**
```bash
node src/solid/scripts/generateCalendar.js --help
node src/solid/scripts/generateCalendar.js --tasks=300 --seed=54321 --ss=30
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
- `src/solid/utils/taskGenerator.js` - Shared generation logic
- `src/solid/scripts/generateCalendar.js` - CLI script
- `src/solid/data/calendar.json` - Generated test data
- `src/solid/components/GanttPerfDemo.jsx` - Performance test UI

## Development Workflow

1. Clone and run `pnpm i`
2. Edit source files in `src/`
3. Run `pnpm build-dev` for watch mode
4. Open `index.html` in browser to see changes
5. Vite automatically rebuilds on file changes

## Code Style

- ES6 modules with import/export
- 4-space indentation, single quotes
- ESLint + Prettier configured
- No TypeScript - pure JavaScript
